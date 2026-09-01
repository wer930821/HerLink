import { calculateAgeFromBirthday } from "./anonymous";

const MIN_AGE = 18;
const MIN_YEAR = 1900;

export function formatBirthdayDisplay(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return value;
  }

  return `${year} 年 ${month} 月 ${day} 日`;
}

export function getTodayIsoDate() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function getMaxSelectableBirthday() {
  const today = new Date();
  return new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
}

export function getAvailableBirthdayYears() {
  const maxYear = getMaxSelectableBirthday().getFullYear();
  const years: number[] = [];

  for (let year = maxYear; year >= MIN_YEAR; year -= 1) {
    years.push(year);
  }

  return years;
}

export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function buildBirthdayIso(year: number, month: number, day: number) {
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}

export function getSafeBirthdayParts(value: string | null | undefined) {
  const maxDate = getMaxSelectableBirthday();
  const fallback = {
    year: maxDate.getFullYear(),
    month: maxDate.getMonth() + 1,
    day: maxDate.getDate(),
  };

  if (!value) {
    return fallback;
  }

  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return fallback;
  }

  const maxDay = getDaysInMonth(year, month);
  return {
    year,
    month: Math.min(Math.max(month, 1), 12),
    day: Math.min(Math.max(day, 1), maxDay),
  };
}

export function isBirthdayWithinAllowedRange(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return false;
  }

  const selected = new Date(year, month - 1, day);
  if (Number.isNaN(selected.getTime())) {
    return false;
  }

  const maxDate = getMaxSelectableBirthday();
  if (selected > maxDate) {
    return false;
  }

  const age = calculateAgeFromBirthday(value);
  return typeof age === "number" && age >= MIN_AGE;
}
