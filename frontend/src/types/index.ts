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
    nextWindowAt: string;
  };
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
  emails: Record<EmailStatus, number>;
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
