export function FormatPhoneNumber(phone: string) {
  phone = phone
    .replace(/\(/, "")
    .replace(/\)/, "")
    .replace(/\s/, "")
    .replace(/-/, "");
  if (phone.length === 10) {
    phone = "+1" + phone;
  }
  return phone;
}
