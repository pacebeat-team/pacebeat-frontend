// 개발 빌드인지 판정하는 유일한 곳. 가상 GPS(?virtual)와 Mock(?scenario)은 개발 빌드에서만 켜진다.
// 이 파일은 vite 타입이 없는 테스트 프로젝트(tsconfig.test.json)에서도 컴파일되므로 import.meta.env는 필요한 모양으로만 좁혀 읽는다.
// 값을 알 수 없으면(테스트·Node) 개발 빌드가 아닌 것으로 본다(차단이 기본이다).
export function isDevBuild(): boolean {
  return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
}
