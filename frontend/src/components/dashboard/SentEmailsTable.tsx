'use client';

import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { ExternalLink, Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { EmailJob, PaginatedResponse } from '@/types';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div className="skeleton" style={{ height: 14, width: i === 6 ? '40%' : '70%' }} />
        </td>
      ))}
    </tr>
  );
}

interface SentEmailsTableProps {
  refreshTrigger?: number;
  mode?: 'sent' | 'review';
}

export default function SentEmailsTable({ refreshTrigger, mode = 'sent' }: SentEmailsTableProps) {
  const isReview = mode === 'review';
  const listLabel = isReview ? 'emails needing review' : 'sent emails';
  const dateLabel = isReview ? 'Attempt started' : 'Sent At';
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoaded = useRef(false);
  const latestRequest = useRef(0);
  const blockingRequest = useRef(false);
  const refreshRequest = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const LIMIT = 10;
  const totalPages = Math.ceil(total / LIMIT);

  const fetchEmails = useCallback(async (showLoading = true) => {
    const blocking = showLoading || !hasLoaded.current;
    if (!blocking && (blockingRequest.current || refreshRequest.current)) return;
    const requestId = ++latestRequest.current;
    if (blocking) {
      blockingRequest.current = true;
      setIsLoading(true);
      setLoadError(false);
    } else {
      refreshRequest.current = true;
      setIsRefreshing(true);
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        ...(search ? { search } : {}),
      });
      const res = await api.get<PaginatedResponse<EmailJob>>(
        `/api/emails/${mode}?${params}`
      );
      if (requestId === latestRequest.current && res.success) {
        setEmails(res.data);
        setTotal(res.total);
      }
    } catch {
      if (requestId === latestRequest.current && blocking) {
        setEmails([]);
        setTotal(0);
        setLoadError(true);
      }
    } finally {
      if (requestId === latestRequest.current) {
        hasLoaded.current = true;
        blockingRequest.current = false;
        refreshRequest.current = false;
        if (blocking) setIsLoading(false);
        setIsRefreshing(false);
      } else if (!blocking) {
        refreshRequest.current = false;
      }
    }
  }, [page, search, mode]);

  useEffect(() => {
    const timeout = setTimeout(() => void fetchEmails(), 0);
    return () => clearTimeout(timeout);
  }, [fetchEmails, refreshTrigger]);

  useEffect(() => {
    const interval = setInterval(() => void fetchEmails(false), 15000);
    return () => clearInterval(interval);
  }, [fetchEmails]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isReview && (
        <div className="review-notice">
          <strong>Delivery needs verification</strong>
          <p>The provider may have received these emails. Automatic retries are paused to prevent duplicates.</p>
          <p>Open attempt details, then check the sender’s Ethereal inbox or provider logs using the message ID, recipient and attempt time. Keep the email on hold until the outcome is confirmed; do not schedule a replacement while delivery is uncertain.</p>
        </div>
      )}
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 360 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="input-field"
              placeholder={isReview ? 'Search recipient, subject or message ID...' : 'Search sent emails...'}
              aria-label={`Search ${listLabel}`}
              style={{ paddingLeft: 34, fontSize: 13 }}
            />
          </div>
          <button type="submit" className="btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }}>
            Search
          </button>
        </form>
        <button onClick={() => void fetchEmails(false)} className="btn-secondary" style={{ padding: '8px 12px' }} aria-label={`Refresh ${listLabel}`} title={`Refresh ${listLabel}`}>
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin-slow' : undefined} />
        </button>
      </div>

      {/* Table */}
      <div className="table-frame">
        {isLoading ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Sender</th>
                <th>{dateLabel}</th>
                <th>Status</th>
                <th>{isReview ? 'Investigation' : 'Preview'}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        ) : loadError ? (
          <div role="alert" style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
            Could not load {listLabel}. Check your connection and try again.
          </div>
        ) : emails.length === 0 ? (
          <EmptyState
            title={search ? 'No matching emails' : isReview ? 'No emails need review' : 'No Sent Emails'}
            description={search ? 'Try a different recipient, subject or message ID.' : isReview ? 'Any delivery with an uncertain outcome will appear here for investigation.' : "Emails sent via your campaigns will appear here once they're delivered."}
            icon="sent"
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Sender</th>
                <th>{dateLabel}</th>
                <th>Status</th>
                <th>{isReview ? 'Investigation' : 'Preview'}</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <Fragment key={email.id}>
                <tr key={email.id}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {email.recipientEmail}
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.subject}
                    </p>
                  </td>
                  <td>{email.senderEmail}</td>
                  <td>
                    {(isReview ? email.deliveryAttemptStartedAt : email.sentAt)
                      ? format(new Date((isReview ? email.deliveryAttemptStartedAt : email.sentAt)!), 'MMM d, yyyy HH:mm:ss')
                      : '—'}
                  </td>
                  <td>
                    <StatusBadge status={email.status} />
                  </td>
                  <td>
                    {isReview ? 'Held for review' : email.previewUrl ? (
                      <a
                        href={email.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--accent)',
                          fontSize: 12,
                          fontWeight: 500,
                          textDecoration: 'none',
                        }}
                      >
                        <ExternalLink size={12} />
                        View
                      </a>
                    ) : '—'}
                  </td>
                </tr>
                {isReview && (
                  <tr>
                    <td colSpan={6}>
                      <details className="review-details">
                        <summary>Attempt details for {email.recipientEmail}</summary>
                        <dl>
                          <dt>Email ID</dt><dd>{email.id}</dd>
                          <dt>Message ID</dt><dd>{email.deliveryMessageId ?? 'Not recorded — investigate by recipient and attempt time'}</dd>
                          <dt>Last error</dt><dd>{email.errorMessage ?? 'No error details recorded'}</dd>
                          <dt>Retry count</dt><dd>{email.retryCount}</dd>
                          <dt>Last updated</dt><dd>{format(new Date(email.updatedAt), 'PPpp')}</dd>
                          <dt>Scheduled for</dt><dd>{format(new Date(email.scheduledAt), 'PPpp')}</dd>
                          <dt>Message body</dt><dd className="review-body">{email.body}</dd>
                        </dl>
                      </details>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Previous page"
              className="btn-secondary"
              style={{ padding: '6px 10px', opacity: page === 1 ? 0.4 : 1 }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              aria-label="Next page"
              className="btn-secondary"
              style={{ padding: '6px 10px', opacity: page === totalPages ? 0.4 : 1 }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
