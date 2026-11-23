// 백엔드 표준 오류 본문: { status_code, error_code, message } (백엔드 app/core/errors.py).
// 본문이 이 모양이 아니면(프록시 오류 등) status만 믿고 error_code는 'UNKNOWN'으로 둔다.
export class ApiError extends Error {
  readonly status: number
  readonly errorCode: string
  constructor(status: number, errorCode: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errorCode = errorCode
  }
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

// 서버에 닿지 못했거나(오프라인·CORS·DNS) 시간 안에 응답이 없는 경우. 서버가 응답한 오류(ApiError)와 구분한다.
export class NetworkError extends Error {
  readonly timedOut: boolean
  constructor(message: string, timedOut = false) {
    super(message)
    this.name = 'NetworkError'
    this.timedOut = timedOut
  }
}

// 요청을 만든 계정이 더 이상 현재 로그인 계정이 아니라서 보내지 않은 경우(로그아웃·계정 전환). 요청은 서버로 나가지 않았다.
export class OwnerChangedError extends Error {
  constructor() {
    super('요청을 만든 계정이 바뀌어 보내지 않았어요.')
    this.name = 'OwnerChangedError'
  }
}

export function parseApiError(status: number, body: unknown): ApiError {
  if (typeof body === 'object' && body !== null) {
    const data = body as Record<string, unknown>
    const code = typeof data.error_code === 'string' ? data.error_code : 'UNKNOWN'
    const message = typeof data.message === 'string' ? data.message : `요청이 실패했어요 (${status})`
    return new ApiError(status, code, message)
  }
  return new ApiError(status, 'UNKNOWN', `요청이 실패했어요 (${status})`)
}
