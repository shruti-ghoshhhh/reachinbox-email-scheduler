// Shared TypeScript types for the frontend

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type EmailStatus =
  | 'SCHEDULED'
  | 'QUEUED'
  | 'SENDING'
  | 'DELIVERY_UNKNOWN'
  | 'SENT'
  | 'FAILED'
  | 'RATE_LIMITED'
  | 'CANCELLED';

export interface EmailJob {
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
  errorMessage: string | null;
  deliveryAttemptStartedAt: string | null;
  deliveryMessageId: string | null;
  retryCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface Sender {
  id: string;
  email: string;
  name: string;
  userId: string;
  createdAt: string;
  rateLimit?: {
    currentCount: number;
    limit: number;
    remaining: number;
    policy: string;
    nextWindowAt: string;
  };
}

export interface SenderAccount {
  email: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  slackConnected: boolean;
}

export interface QueueStats {
  queue: {
    waiting: number;
    delayed: number;
    active: number;
    completed: number;
    failed: number;
  };
  emails: Partial<Record<EmailStatus, number>>;
}

export interface ScheduleEmailPayload {
  senderEmail: string;
  senderName: string;
  recipients: string[];
  subject: string;
  body: string;
  startAt: string;
  delayBetweenEmailsMs: number;
  hourlyLimit?: number;
  campaignId?: string;
}
