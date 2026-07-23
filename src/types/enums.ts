export const PROVIDERS = ["GOOGLE", "CALDAV"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const EVENT_STATUSES = ["ACTIVE", "DELETED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
