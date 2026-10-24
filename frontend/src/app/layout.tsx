import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReachInbox – Email Scheduler",
  description: "Production-grade email scheduling dashboard powered by BullMQ and Redis",
  keywords: ["email scheduler", "reachinbox", "cold email", "outreach"],
  openGraph: {
    title: "ReachInbox Email Scheduler",
    description: "Schedule and send cold emails at scale",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const saved=localStorage.getItem('reachinbox-theme');document.documentElement.dataset.theme=saved==='light'?'light':'dark'}catch{document.documentElement.dataset.theme='dark'}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--toast-bg)',
                color: 'var(--toast-foreground)',
                border: '1px solid var(--toast-border)',
                borderRadius: '9999px',
                fontSize: '14px',
              },
              success: {
                iconTheme: { primary: '#9bd3ac', secondary: 'var(--toast-bg)' },
              },
              error: {
                iconTheme: { primary: '#f1a1a1', secondary: 'var(--toast-bg)' },
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
