import { normalizePhone } from "./site-chat";

export type OwnerPhoneRecord = {
  id: number;
  phone: string | null;
};

/**
 * Finds an owner by a usable Brazilian phone number without changing the
 * stored value. Existing records may contain either masked or plain phones.
 */
export function matchOwnerByPhone(
  owners: OwnerPhoneRecord[],
  rawPhone: string | null | undefined,
): OwnerPhoneRecord | null {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return null;
  return owners.find((owner) => normalizePhone(owner.phone) === normalized) ?? null;
}