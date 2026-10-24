'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageLoader } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

function CallbackInner() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      toast.error('Authentication failed');
      router.push('/login');
      return;
    }

    login(token)
      .then(() => {
        toast.success('Welcome back! 🎉');
        router.push('/dashboard');
      })
      .catch(() => {
        toast.error('Login failed. Please try again.');
        router.push('/login');
      });
  }, [login, params, router]);

  return <FullPageLoader />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <CallbackInner />
    </Suspense>
  );
}
