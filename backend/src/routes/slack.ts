import { Router, Response, Request } from 'express';
import { prisma } from '../config/database';
import { authenticateJWT, type AuthRequest } from '../middleware/auth';
import {
  getSlackAuthUrl,
  exchangeSlackCode,
  saveSlackToken,
  disconnectSlack,
} from '../services/slackService';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { randomBytes } from 'crypto';

const router = Router();

// GET /api/slack/connect  – initiates OAuth flow
router.get('/connect', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const state = randomBytes(32).toString('hex');
    Object.assign(req.session, { slackOAuthState: state });
    // State is unpredictable, expires quickly, and is consumed exactly once.
    // Store the authenticated user's identity server-side; never trust callback state as a user id.
    await redis.set(
      `slack_oauth_state:${state}`,
      JSON.stringify({ userId: req.authUser!.userId, sessionId: req.sessionID }),
      'EX', 600, 'NX'
    );
    const url = getSlackAuthUrl(state);
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Slack not configured' });
  }
});

// GET /api/slack/callback – handles OAuth callback
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (!state) {
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack_error=true`);
  }

  try {
    const statePayload = await redis.getdel(`slack_oauth_state:${state}`);
    const pending = statePayload ? JSON.parse(statePayload) as { userId: string; sessionId: string } : null;
    const session = req.session as typeof req.session & { slackOAuthState?: string };
    const sessionState = session.slackOAuthState;
    delete session.slackOAuthState;
    if (error || !code || !pending || pending.sessionId !== req.sessionID || sessionState !== state) {
      return res.redirect(`${env.FRONTEND_URL}/dashboard?slack_error=true`);
    }
    const { accessToken, teamId, userId: slackUserId } = await exchangeSlackCode(code);
    await saveSlackToken(pending.userId, accessToken, teamId, slackUserId);

    res.redirect(`${env.FRONTEND_URL}/dashboard?slack_connected=true`);
  } catch (err) {
    console.error('Slack callback error:', err);
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack_error=true`);
  }
});

// GET /api/slack/status – check connection status
router.get('/status', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.userId },
      select: { slackConnected: true, slackTeamId: true },
    });

    res.json({
      success: true,
      data: {
        connected: user?.slackConnected ?? false,
        teamId: user?.slackTeamId ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get Slack status' });
  }
});

// DELETE /api/slack/disconnect
router.delete('/disconnect', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    await disconnectSlack(req.authUser!.userId);
    res.json({ success: true, message: 'Slack disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to disconnect Slack' });
  }
});

export default router;
