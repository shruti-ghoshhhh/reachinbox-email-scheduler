'use client';

import { useEffect, useState } from 'react';
import { X, Mail, Clock, Zap, Hash, Send, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { ApiResponse, ScheduleEmailPayload, SenderAccount } from '@/types';
import CsvUploader from '@/components/ui/CsvUploader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

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

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="animate-fade-in"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(99, 102, 241, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'rgba(99, 102, 241, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Mail size={18} color="#6366f1" />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Compose New Campaign
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Schedule bulk email campaign
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
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
            <X size={15} />
          </button>
        </div>

        {/* Form */}
        <div style={{ overflow: 'auto', padding: '24px', flex: 1 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Sender Info */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
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
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
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
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Scheduling Options
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
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
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Zap size={13} /> Delay (ms)
                  </label>
                  <input
                    name="delayBetweenEmailsMs"
                    type="number"
                    value={form.delayBetweenEmailsMs}
                    onChange={handleChange}
                    className="input-field"
                    min={0}
                    step={500}
                  />
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
                </div>
              </div>
            </div>

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 8,
                  padding: '10px 14px',
                }}
              >
                <AlertCircle size={15} color="#f87171" />
                <p style={{ fontSize: 13, color: '#f87171' }}>{error}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
              <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>
                Cancel
              </button>
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
      </div>
    </div>
  );
}
