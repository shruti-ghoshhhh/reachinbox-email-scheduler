import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticateJWT, type AuthRequest } from '../middleware/auth';
import { getRateLimitStatus } from '../services/rateLimitService';

const router = Router();

router.use(authenticateJWT);

// GET /api/senders – list all senders for the user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const senders = await prisma.sender.findMany({
      where: { userId: req.authUser!.userId },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with rate limit status
    const enriched = await Promise.all(
      senders.map(async (sender) => {
        const rateLimit = await getRateLimitStatus(sender.id);
        return {
          ...sender,
          createdAt: sender.createdAt.toISOString(),
          updatedAt: sender.updatedAt.toISOString(),
          rateLimit,
        };
      })
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch senders' });
  }
});

// POST /api/senders – create a sender
router.post('/', async (req: AuthRequest, res: Response) => {
  const { email, name } = req.body as { email?: string; name?: string };

  if (!email || !name) {
    res.status(400).json({ success: false, message: 'email and name are required' });
    return;
  }

  try {
    const sender = await prisma.sender.upsert({
      where: { email_userId: { email, userId: req.authUser!.userId } },
      create: { email, name, userId: req.authUser!.userId },
      update: { name },
    });

    res.status(201).json({
      success: true,
      data: {
        ...sender,
        createdAt: sender.createdAt.toISOString(),
        updatedAt: sender.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create sender' });
  }
});

// DELETE /api/senders/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.sender.deleteMany({
      where: { id: req.params.id, userId: req.authUser!.userId },
    });
    res.json({ success: true, message: 'Sender deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete sender' });
  }
});

export default router;
