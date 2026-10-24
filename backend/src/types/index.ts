// Shared TypeScript types

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type EmailStatus =
  | 'SCHEDULED'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'RATE_LIMITED'
  | 'CANCELLED';

export interface EmailJobResponse {
  id: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  previewUrl: string | null;
  campaignId: string | null;
  createdAt: string;
}

export interface SenderResponse {
  id: string;
  email: string;
  name: string;
  userId: string;
  createdAt: string;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  slackConnected: boolean;
}

export interface ScheduleEmailRequest {
  senderEmail: string;
  senderName: string;
  recipients: string[];
  subject: string;
  body: string;
  startAt: string; // ISO string
  delayBetweenEmailsMs?: number; // ms between each email
  hourlyLimit?: number;
  campaignId?: string;
}
