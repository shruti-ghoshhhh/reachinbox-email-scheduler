'use client';

import { useEffect, useState } from 'react';
import { X, Mail, Clock, Zap, Hash, Send, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { ApiResponse, ScheduleEmailPayload, SenderAccount } from '@/types';
import CsvUploader from '@/components/ui/CsvUploader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import * as Dialog from '@radix-ui/react-dialog';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ComposeModal({ isOpen, onClose, onSuccess }: ComposeModalProps) {
  const [form, setForm] = useState({
    senderEmail: '',
    senderName: '',
    subject: '',
    body: '',
    startAt: '',
    delayBetweenEmailsMs: 2000,
    hourlyLimit: 50,
  });
  const [recipients, setRecipients] = useState<string[]>([]);
  const [senderAccounts, setSenderAccounts] = useState<SenderAccount[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    api.get<ApiResponse<SenderAccount[]>>('/api/senders/accounts')
      .then((res) => {
        if (cancelled) return;
        const accounts = res.data ?? [];
        setSenderAccounts(accounts);
        setForm((prev) => {
          if (prev.senderEmail && accounts.some((account) => account.email === prev.senderEmail)) return prev;
          return { ...prev, senderEmail: accounts[0]?.email ?? '', senderName: accounts[0]?.email ?? '' };
        });
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || 'Could not load sender accounts.');
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => {
      if (name === 'senderEmail') {
        const account = senderAccounts.find((item) => item.email === value);
        return { ...prev, senderEmail: value, senderName: account?.email ?? '' };
      }
      return {
        ...prev,
        [name]: name === 'delayBetweenEmailsMs' || name === 'hourlyLimit'
          ? parseInt(value, 10) || 0
          : value,
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (recipients.length === 0) {
      setError('Please upload a CSV/TXT file with recipient emails.');
      return;
    }

    if (!form.startAt) {
      setError('Please set a start time for the campaign.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: ScheduleEmailPayload = {
        ...form,
        recipients,
        startAt: new Date(form.startAt).toISOString(),
      };

      const res = await api.post<ApiResponse<{ scheduled: number; campaignId: string }>>(
        '/api/emails/schedule',
        payload
      );

      if (res.success) {
        toast.success(`✅ ${res.data?.scheduled} emails scheduled!`);
        onSuccess();
        onClose();
        resetForm();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({
      senderEmail: '',
      senderName: '',
      subject: '',
      body: '',
      startAt: '',
      delayBetweenEmailsMs: 2000,
      hourlyLimit: 50,
    });
    setRecipients([]);
    setError(null);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="compose-overlay" />
        <Dialog.Content
        className="modal-panel"
        style={{
          position: 'fixed',
          zIndex: 1001,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '100%',
          maxWidth: 640,
          maxHeight: 'min(90vh, 900px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--canvas-soft)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'var(--canvas-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Mail size={18} color="currentColor" />
            </div>
            <div>
              <Dialog.Title asChild>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Compose New Campaign
                </h2>
              </Dialog.Title>
              <Dialog.Description asChild>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Schedule bulk email campaign</p>
              </Dialog.Description>
            </div>
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              className="modal-close"
              aria-label="Close compose dialog"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
            >
              <X size={17} />
            </button>
          </Dialog.Close>
        </div>

        {/* Form */}
        <div style={{ overflow: 'auto', padding: '24px', flex: 1 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Sender Info */}
            <div>
              <p className="modal-eyebrow" style={{ marginBottom: 10 }}>
                Sender Information
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Sending Account *
                  </label>
                  <select
                    name="senderEmail"
                    value={form.senderEmail}
                    onChange={handleChange}
                    className="input-field"
                    disabled={senderAccounts.length === 0}
                    required
                  >
                    <option value="" disabled>{senderAccounts.length === 0 ? 'Loading sender accounts…' : 'Select a sender account'}</option>
                    {senderAccounts.map((account) => <option key={account.email} value={account.email}>{account.email}</option>)}
                  </select>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    The selected account will send the campaign.
                  </p>
                </div>
              </div>
            </div>

            {/* Email Content */}
            <div>
              <p className="modal-eyebrow" style={{ marginBottom: 10 }}>
                Email Content
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Subject *
                  </label>
                  <input
                    name="subject"
                    value={form.subject}
                    onChange={handleChange}
                    className="input-field"
                    placeholder="Your compelling subject line..."
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Email Body *
                  </label>
                  <textarea
                    name="body"
                    value={form.body}
                    onChange={handleChange}
                    className="input-field"
                    placeholder="Write your email content here... HTML is supported."
                    required
                  />
                </div>
              </div>
            </div>

            {/* Recipients */}
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                Recipients (CSV / TXT) *
              </label>
              <CsvUploader onEmailsParsed={setRecipients} />
              {recipients.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6 }}>
                  📋 {recipients.length} unique emails queued for this campaign
                </p>
              )}
            </div>

            {/* Scheduling */}
            <div>
              <p className="modal-eyebrow" style={{ marginBottom: 10 }}>
                Scheduling Options
              </p>
              <div className="schedule-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Clock size={13} /> Start Time *
                  </label>
                  <input
                    name="startAt"
                    type="datetime-local"
                    value={form.startAt}
                    onChange={handleChange}
                    className="input-field"
                    required
            style={{ colorScheme: 'light' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Zap size={13} /> Delay (ms)
                  </label>
                  <input
                    name="delayBetweenEmailsMs"
                    aria-describedby="send-delay-help"
                    type="number"
                    value={form.delayBetweenEmailsMs}
                    onChange={handleChange}
                    className="input-field"
                    min={0}
                    step={500}
                  />
                  <small id="send-delay-help" style={{ display: 'block', marginTop: 6, color: 'var(--text-tertiary)', fontSize: 11 }}>
                    Sends use the greater of this delay and the server’s provider minimum. Zero does not disable throttling.
                  </small>
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Hash size={13} /> Hourly Limit
                  </label>
                  <input
                    name="hourlyLimit"
                    type="number"
                    value={form.hourlyLimit}
                    onChange={handleChange}
                    className="input-field"
                    min={1}
                  />
                  <small style={{ display: 'block', marginTop: 6, color: 'var(--text-tertiary)', fontSize: 11 }}>
                    Campaign cap; the shared sender limit still applies across all campaigns.
                  </small>
                </div>
              </div>
            </div>

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--error-bg)',
                  border: '1px solid var(--error-bg)',
                  borderRadius: 12,
                  padding: '10px 14px',
                }}
              >
                <AlertCircle size={15} color="var(--error)" />
                <p style={{ fontSize: 13, color: 'var(--error)', margin: 0 }}>{error}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="btn-primary"
                style={{ flex: 2 }}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <><LoadingSpinner size={16} /> Scheduling...</>
                ) : (
                  <><Send size={16} /> Schedule Campaign</>
                )}
              </button>
            </div>
          </form>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
