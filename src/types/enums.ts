export const EVENT_STATUSES = ["ACTIVE", "DELETED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
