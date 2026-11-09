import { create } from "zustand";

export type Gender = "female" | "male" | "unspecified";

interface ProfileState {
  nickname: string;
  birthYear: number;
  gender: Gender;
  height: number | null;
  weight: number | null;
  setNickname: (nickname: string) => void;
  setBirthYear: (birthYear: number) => void;
  setGender: (gender: Gender) => void;
  setHeight: (height: number | null) => void;
  setWeight: (weight: number | null) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  nickname: "",
  birthYear: 2003,
  gender: "unspecified",
  height: 165,
  weight: null,
  setNickname: (nickname) => set({ nickname }),
  setBirthYear: (birthYear) => set({ birthYear }),
  setGender: (gender) => set({ gender }),
  setHeight: (height) => set({ height }),
  setWeight: (weight) => set({ weight }),
}));
