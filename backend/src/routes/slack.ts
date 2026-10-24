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

const router = Router();

// GET /api/slack/connect  – initiates OAuth flow
router.get('/connect', authenticateJWT, (req: AuthRequest, res: Response) => {
  try {
    const state = req.user!.userId; // use userId as state for security
    const url = getSlackAuthUrl(state);
    res.redirect(url);
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

  if (error || !code || !state) {
    return res.redirect(`${env.FRONTEND_URL}/dashboard?slack_error=true`);
  }

  try {
    const { accessToken, teamId, userId: slackUserId } = await exchangeSlackCode(code);
    await saveSlackToken(state, accessToken, teamId, slackUserId);

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
      where: { id: req.user!.userId },
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
    await disconnectSlack(req.user!.userId);
    res.json({ success: true, message: 'Slack disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to disconnect Slack' });
  }
});

export default router;
