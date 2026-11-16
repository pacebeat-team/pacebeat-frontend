import type { GeolocationLike, PositionErrorLike, PositionLike } from './geolocationSource.ts'
import { generateVirtualRun, getVirtualRunDurationMs } from './virtualRun.ts'
import type { VirtualEvent, VirtualScenario } from './virtualRun.ts'

// 가짜 브라우저 위치(GeolocationLike): 가상 시나리오를 정해진 시각에 콜백으로 전달한다.
// - createGeolocationSource(handlers, { env: () => ({ isSecureContext: true, geolocation: 이 객체 }) })에 꽂으면
//   실제 GPS와 똑같은 코드(RawFix 변환, 시작·중지, 오류 처리)를 거친다. 이 파일은 검증과 계산을 하지 않는다.
// - 콜백은 실제 브라우저처럼 watchPosition이 돌아온 뒤에 비동기로만 호출한다.
// - 시나리오가 끝나면 더 이상 좌표를 보내지 않는다. (그 뒤 GPS 상태는 시간이 지나 '끊김'이 된다.)
// - watchPosition을 호출할 때마다 시나리오는 처음부터 시작한다. (감시마다 독립)

// 시간을 다루는 부분만 주입할 수 있게 한다. 테스트는 수동 시계를 넣어서 실제 시간을 기다리지 않는다.
export interface VirtualClock {
  // 현재 시각(epoch ms)
  now(): number
  // delayMs 뒤에 callback을 한 번 실행하도록 예약한다. 돌려주는 함수를 부르면 예약을 취소한다.
  schedule(callback: () => void, delayMs: number): () => void
}

export const SYSTEM_CLOCK: VirtualClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    return () => clearTimeout(handle)
  },
}

interface VirtualWatch {
  active: boolean
  cancel: () => void
}

export interface VirtualGeolocationOptions {
  // 시나리오의 마지막 사건을 전달하고 시나리오 길이도 지난 뒤 감시마다 한 번 호출한다.
  // GPS 오류(onError)와는 별개의 신호다. clearWatch로 감시를 끝냈으면 호출하지 않는다.
  readonly onComplete?: () => void
}

export function createVirtualGeolocation(
  scenario: VirtualScenario,
  clock: VirtualClock = SYSTEM_CLOCK,
  options: VirtualGeolocationOptions = {},
): GeolocationLike {
  // 시나리오는 만들 때 한 번만 풀어 둔다. (잘못된 시나리오는 여기서 RangeError)
  const events: readonly VirtualEvent[] = generateVirtualRun(scenario)
  // 끝난 시각: 마지막 사건 도착 시각과 시나리오 길이 중 늦은 쪽 (끝부분이 GPS 끊김이어도 길이만큼은 기다린다.)
  const completeAtMs = Math.max(
    getVirtualRunDurationMs(scenario),
    events.length > 0 ? events[events.length - 1].deliverAtMs : 0,
  )
  const watches = new Map<number, VirtualWatch>()
  let nextWatchId = 1

  return {
    watchPosition(
      onSuccess: (position: PositionLike) => void,
      onError: (error: PositionErrorLike) => void,
    ): number {
      const watchId = nextWatchId
      nextWatchId += 1
      const startedAt = clock.now()
      const watch: VirtualWatch = { active: true, cancel: () => {} }
      watches.set(watchId, watch)
      let index = 0

      const deliver = (event: VirtualEvent): void => {
        if (event.kind === 'fix') {
          onSuccess({
            coords: { latitude: event.lat, longitude: event.lng, accuracy: event.accuracyM },
            timestamp: startedAt + event.offsetMs,
          })
        } else {
          onError({ code: event.code })
        }
      }

      let completed = false

      const scheduleNext = (): void => {
        let dueAtMs: number
        if (index < events.length) {
          dueAtMs = events[index].deliverAtMs
        } else if (!completed) {
          dueAtMs = completeAtMs
        } else {
          return
        }
        const delayMs = Math.max(0, startedAt + dueAtMs - clock.now())
        watch.cancel = clock.schedule(fire, delayMs)
      }

      // 도착 시각이 된 사건을 모두 순서대로 전달한다. (타이머가 늦게 실행돼 여러 개가 밀려 있어도 순서를 지킨다.)
      // 콜백이 예외를 던져도 다음 사건이 이어지도록, 다음 예약은 finally에서 한다. 예외는 삼키지 않는다.
      function fire(): void {
        if (!watch.active) {
          return
        }
        const elapsedMs = clock.now() - startedAt
        try {
          while (watch.active && index < events.length && events[index].deliverAtMs <= elapsedMs) {
            const event = events[index]
            index += 1
            deliver(event)
          }
          // 모든 사건을 전달했고 시나리오 길이도 지났으면 끝났음을 한 번만 알린다.
          // (onComplete가 clearWatch를 불러도, 예외를 던져도 안전하다.)
          if (watch.active && index >= events.length && !completed && elapsedMs >= completeAtMs) {
            completed = true
            options.onComplete?.()
          }
        } finally {
          if (watch.active) {
            scheduleNext()
          }
        }
      }

      scheduleNext()
      return watchId
    },

    clearWatch(watchId: number): void {
      const watch = watches.get(watchId)
      if (watch === undefined) {
        return
      }
      watch.active = false
      watch.cancel()
      watches.delete(watchId)
    },
  }
}
