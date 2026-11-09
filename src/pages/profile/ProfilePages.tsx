import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BackHeader,
  BottomSheet,
  ChevronRightIcon,
  PrimaryButton,
  ProfileFooter,
  StepProgress,
} from "../../components/profile/ProfileUI";
import {
  type Gender,
  useProfileStore,
} from "../../features/profile/profileStore";

const consentItems = [
  {
    id: "age",
    label: "[필수] 만 14세 이상이에요",
    required: true,
    view: false,
  },
  { id: "terms", label: "[필수] 서비스 이용약관", required: true, view: true },
  {
    id: "privacy",
    label: "[필수] 개인정보 수집·이용",
    required: true,
    view: true,
  },
  {
    id: "location",
    label: "[필수] 위치기반서비스 이용약관",
    required: true,
    view: true,
  },
  {
    id: "marketing",
    label: "[선택] 마케팅 정보 수신",
    required: false,
    view: true,
  },
] as const;

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[11px] border ${checked ? "border-[#baff2a] bg-[#baff2a]" : "border-[#dedee5] bg-white"}`}
    >
      {checked && (
        <span className="h-2 w-3 rotate-[-45deg] border-b-2 border-l-2 border-[#111]" />
      )}
    </span>
  );
}

export function ProfileConsentPage() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [termsOpen, setTermsOpen] = useState(false);
  const requiredComplete = consentItems
    .filter((item) => item.required)
    .every((item) => checked[item.id]);
  const allChecked = consentItems.every((item) => checked[item.id]);
  const toggleAll = () =>
    setChecked(
      Object.fromEntries(consentItems.map((item) => [item.id, !allChecked])),
    );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="가입하기" />
        <h1 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px]">
          시작하기 전에
          <br />
          확인해 주세요.
        </h1>
        <p className="mt-4 text-[14px] text-[#626174]">
          필수 항목만 동의해도 괜찮아요.
        </p>
        <button
          type="button"
          onClick={toggleAll}
          className="mt-5 flex h-16 w-full items-center gap-3.5 text-left"
        >
          <Checkbox checked={allChecked} />
          <span>
            <strong className="block text-[18px] font-medium">
              전체 동의하기
            </strong>
            <span className="mt-1 block text-[13px] text-[#626174]">
              필수 4개와 선택 1개를 함께 선택해요.
            </span>
          </span>
        </button>
        <div className="mt-3 border-t border-[#dedee5] pt-2">
          {consentItems.map((item) => (
            <div key={item.id} className="flex h-14 items-center gap-2.5">
              <button
                type="button"
                onClick={() =>
                  setChecked((value) => ({
                    ...value,
                    [item.id]: !value[item.id],
                  }))
                }
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <Checkbox checked={Boolean(checked[item.id])} />
                <span className="text-[15px]">{item.label}</span>
              </button>
              {item.view && (
                <button
                  type="button"
                  onClick={() => setTermsOpen(true)}
                  className="h-11 w-11 text-[13px] text-[#626174]"
                >
                  보기
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-5">
          <PrimaryButton
            disabled={!requiredComplete}
            onClick={() => navigate("/profile/nickname")}
          >
            동의하고 계속하기
          </PrimaryButton>
        </div>
        <p className="mt-3 text-[13px] text-[#626174]">
          필수 항목에 동의하면 계속할 수 있어요.
        </p>
      </div>
      {termsOpen && (
        <div className="absolute inset-0 z-20 flex items-end">
          <button
            type="button"
            aria-label="약관 닫기"
            onClick={() => setTermsOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <section className="relative h-[360px] w-full rounded-t-[28px] bg-white p-6">
            <div className="flex h-11 items-center justify-between">
              <h2 className="text-[20px] font-medium">약관 원문</h2>
              <button
                type="button"
                onClick={() => setTermsOpen(false)}
                className="h-11 w-11 text-[28px]"
              >
                ×
              </button>
            </div>
            <h3 className="mt-6 text-[28px] font-light leading-[38px]">
              서비스 약관이
              <br />
              연결될 자리예요.
            </h3>
            <p className="mt-5 text-[15px] leading-[23px] text-[#626174]">
              이 프로토타입에는 약관 원문이 포함되지 않았어요.
              <br />
              실제 로그인이나 개인정보 동의를 저장하지 않아요.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

export function ProfileNicknamePage() {
  const navigate = useNavigate();
  const nickname = useProfileStore((state) => state.nickname);
  const setNickname = useProfileStore((state) => state.setNickname);
  const valid = nickname.trim().length >= 2 && nickname.trim().length <= 10;
  const suggestions = ["삼색", "도도", "야통"];
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="프로필 만들기" />
        <div className="mt-2">
          <StepProgress current={1} />
        </div>
        <h1 className="mt-3 text-[34px] font-light leading-[44px] tracking-[-1.02px]">
          뭐라고
          <br />
          불러드릴까요?
        </h1>
        <p className="mt-2.5 text-[14px] text-[#626174]">
          러닝 안내와 기록에 표시돼요.
        </p>
        <div className="mt-7 flex h-16 items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl bg-[#baff2a] text-[21px] font-medium">
            {nickname.trim().slice(0, 1) || "P"}
          </span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value.slice(0, 10))}
            autoFocus
            placeholder="닉네임"
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-[30px] font-light tracking-[-0.9px] outline-none"
          />
        </div>
        <div className="h-px bg-[#dedee5]" />
        <div className="mt-2.5 flex justify-between text-[13px] text-[#626174]">
          <span>
            {valid ? "2~10자 조건을 만족해요." : "2~10자로 입력해 주세요."}
          </span>
          <span className="font-poppins">{nickname.length} / 10</span>
        </div>
        <div className="mt-5 flex items-center gap-2 text-[13px] text-[#626174]">
          <span>추천 이름</span>
          {suggestions.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setNickname(item)}
              className="rounded-full bg-[#f4f4f6] px-3 py-2"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <ProfileFooter>
        <PrimaryButton
          disabled={!valid}
          onClick={() => navigate("/profile/demographics")}
        >
          다음
        </PrimaryButton>
      </ProfileFooter>
    </div>
  );
}

export function ProfileDemographicsPage() {
  const navigate = useNavigate();
  const { birthYear, gender, setBirthYear, setGender } = useProfileStore();
  const genders: Array<{ value: Gender; label: string }> = [
    { value: "female", label: "여성" },
    { value: "male", label: "남성" },
    { value: "unspecified", label: "선택 안 함" },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="프로필 만들기" />
        <div className="mt-2">
          <StepProgress current={2} optional />
        </div>
        <h1 className="mt-3 text-[34px] font-light leading-[44px] tracking-[-1.02px]">
          나이와 성별을
          <br />
          알려주세요.
        </h1>
        <p className="mt-2.5 text-[14px] text-[#626174]">
          소모 칼로리 계산에만 써요.
        </p>
        <div className="mt-10">
          <div className="flex h-[88px] items-center">
            <div className="flex-1">
              <p className="text-[16px] font-medium">출생연도</p>
              <p className="mt-1 text-[13px] text-[#626174]">선택 항목</p>
            </div>
            <input
              type="number"
              min={1940}
              max={2020}
              value={birthYear}
              onChange={(e) => setBirthYear(Number(e.target.value))}
              className="w-[100px] bg-transparent text-right font-poppins text-[28px] font-light outline-none"
            />
            <span className="ml-1 text-[16px] text-[#626174]">년</span>
            <ChevronRightIcon />
          </div>
          <div className="h-px bg-[#dedee5]" />
          <p className="mt-8 text-[16px] font-medium">성별</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {genders.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => setGender(item.value)}
                className={`h-11 rounded-full text-[14px] ${gender === item.value ? "bg-[#baff2a]" : "bg-[#f4f4f6]"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-8 border-t border-[#dedee5] pt-7">
            <p className="text-[15px] font-medium">왜 필요한가요?</p>
            <p className="mt-3 text-[14px] leading-6 text-[#626174]">
              칼로리는 나이·성별·체중으로 계산해요.
              <br />
              입력하지 않으면 칼로리 대신
              <br />
              거리와 시간만 보여 드려요.
            </p>
          </div>
        </div>
      </div>
      <ProfileFooter>
        <PrimaryButton onClick={() => navigate("/profile/body")}>
          다음
        </PrimaryButton>
        <button
          type="button"
          onClick={() => navigate("/profile/body")}
          className="mt-1 h-11 w-full text-[14px] text-[#626174]"
        >
          건너뛰기
        </button>
      </ProfileFooter>
    </div>
  );
}

export function ProfileBodyPage() {
  const navigate = useNavigate();
  const { height, weight, setHeight, setWeight } = useProfileStore();
  const [picker, setPicker] = useState<"height" | "weight" | null>(null);
  const values = useMemo(
    () =>
      picker === "height" ? [163, 164, 165, 166, 167] : [53, 54, 55, 56, 57],
    [picker],
  );
  const selected = picker === "height" ? height : weight;
  const choose = (value: number) =>
    picker === "height" ? setHeight(value) : setWeight(value);
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="프로필 만들기" />
        <div className="mt-2">
          <StepProgress current={3} optional />
        </div>
        <h1 className="mt-3 text-[34px] font-light leading-[44px] tracking-[-1.02px]">
          키와 몸무게를
          <br />
          알려주세요.
        </h1>
        <p className="mt-2.5 text-[15px] text-[#626174]">
          소모 칼로리와 보폭 추정에 써요.
        </p>
        <div className="mt-7">
          {(
            [
              { key: "height", label: "키", value: height, unit: "cm" },
              { key: "weight", label: "몸무게", value: weight, unit: "kg" },
            ] as const
          ).map((field) => (
            <button
              type="button"
              key={field.key}
              onClick={() => setPicker(field.key)}
              className="flex h-[88px] w-full items-center border-b border-[#dedee5] text-left"
            >
              <span className="flex-1">
                <strong className="block text-[16px] font-medium">
                  {field.label}
                </strong>
                <span className="mt-1 block text-[13px] text-[#626174]">
                  선택 항목
                </span>
              </span>
              <span className="font-poppins text-[28px] font-light">
                {field.value ?? "—"}
              </span>
              <span className="ml-1.5 text-[16px] text-[#626174]">
                {field.unit}
              </span>
              <span className="ml-3">
                <ChevronRightIcon />
              </span>
            </button>
          ))}
        </div>
        <p className="mt-7 text-[15px] leading-6 text-[#626174]">
          둘 다 입력하지 않아도 시작할 수 있어요.
          <br />
          입력한 정보는 마이의 프로필에서
          <br />
          언제든 고치거나 지울 수 있어요.
        </p>
        <p className="mt-7 text-[14px] text-[#626174]">
          ♢&nbsp;&nbsp; 선택한 값을 확인한 뒤에만 저장돼요.
        </p>
      </div>
      <ProfileFooter>
        <PrimaryButton onClick={() => navigate("/home")}>
          시작하기
        </PrimaryButton>
        <button
          type="button"
          onClick={() => navigate("/home")}
          className="mt-1 h-11 w-full text-[14px] text-[#626174]"
        >
          건너뛰기
        </button>
      </ProfileFooter>
      {picker && (
        <BottomSheet
          title={picker === "height" ? "키" : "몸무게"}
          onClose={() => setPicker(null)}
        >
          <div className="mt-3">
            {values.map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => choose(value)}
                className={`flex h-10 w-full items-center justify-center rounded-[10px] font-poppins ${selected === value ? "bg-[#f4f4f6] text-[24px] text-[#111]" : "text-[21px] text-[#626174]"}`}
              >
                {value}
                {selected === value
                  ? ` ${picker === "height" ? "cm" : "kg"}`
                  : ""}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-[#626174]">
            완료를 눌러 선택한 값을 확인해요.
          </p>
        </BottomSheet>
      )}
    </div>
  );
}
