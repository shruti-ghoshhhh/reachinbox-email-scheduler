import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { prisma } from '../config/database';
import { generateToken, authenticateJWT, type AuthRequest } from '../middleware/auth';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { randomBytes } from 'crypto';

const router = Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALLBACK_URL
  );
}

// GET /api/auth/google
router.get('/google', async (req: Request, res: Response) => {
  const state = randomBytes(32).toString('hex');
  Object.assign(req.session, { googleOAuthState: state });
  try {
    // Bind the one-time OAuth state to the browser session as well as storing it
    // centrally, so callbacks can be validated across API instances.
    await redis.set(`google_oauth_state:${state}`, req.sessionID, 'EX', 600, 'NX');
  } catch (err) {
    console.error('Google OAuth state storage error:', err);
    return res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
  }

  const oauth2Client = getOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    state,
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  });
  res.redirect(authUrl);
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (!state) {
    return res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
  }

  try {
    const initiatingSessionId = await redis.getdel(`google_oauth_state:${state}`);
    const sessionState = (req.session as typeof req.session & { googleOAuthState?: string }).googleOAuthState;
    delete (req.session as typeof req.session & { googleOAuthState?: string }).googleOAuthState;
    if (error || !code || !initiatingSessionId || initiatingSessionId !== req.sessionID || sessionState !== state) {
      return res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
    }

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.id || !profile.email) {
      throw new Error('Invalid Google profile');
    }

    // Upsert user
    const user = await prisma.user.upsert({
      where: { googleId: profile.id },
      create: {
        googleId: profile.id,
        email: profile.email,
        name: profile.name ?? 'User',
        avatar: profile.picture,
      },
      update: {
        email: profile.email,
        name: profile.name ?? 'User',
        avatar: profile.picture,
      },
    });

    const token = generateToken({ userId: user.id, email: user.email });

    // Redirect to frontend with token
    res.redirect(`${env.FRONTEND_URL}/auth/callback?token=${token}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect(`${env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

// GET /api/auth/me
router.get('/me', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        slackConnected: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateJWT, (_req: Request, res: Response) => {
  // JWT is stateless – client just discards token
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
