import { Client } from '@elastic/elasticsearch';
import { env } from './env';

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
});

export const EMAIL_INDEX = 'email_jobs';

export async function connectElasticsearch(): Promise<void> {
  try {
    await esClient.ping();
    console.log('✅ Elasticsearch connected');
    await ensureEmailIndex();
  } catch (error) {
    console.warn('⚠️  Elasticsearch not available, search features will be limited:', (error as Error).message);
  }
}

async function ensureEmailIndex(): Promise<void> {
  const exists = await esClient.indices.exists({ index: EMAIL_INDEX });
  if (!exists) {
    await esClient.indices.create({
      index: EMAIL_INDEX,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          userId: { type: 'keyword' },
          senderId: { type: 'keyword' },
          senderEmail: { type: 'keyword' },
          recipientEmail: { type: 'keyword' },
          subject: { type: 'text', analyzer: 'standard' },
          body: { type: 'text', analyzer: 'standard' },
          scheduledAt: { type: 'date' },
          sentAt: { type: 'date' },
          status: { type: 'keyword' },
          campaignId: { type: 'keyword' },
          createdAt: { type: 'date' },
        },
      },
    });
    console.log(`✅ Elasticsearch index "${EMAIL_INDEX}" created`);
  }
}

export async function indexEmailJob(doc: {
  id: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  sentAt?: Date | null;
  status: string;
  campaignId?: string | null;
  createdAt: Date;
}): Promise<void> {
  try {
    await esClient.index({
      index: EMAIL_INDEX,
      id: doc.id,
      document: {
        ...doc,
        scheduledAt: doc.scheduledAt.toISOString(),
        sentAt: doc.sentAt?.toISOString() ?? null,
        createdAt: doc.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.warn('⚠️  ES indexing failed:', (error as Error).message);
  }
}

export async function updateEmailJobIndex(id: string, updates: Record<string, unknown>): Promise<void> {
  try {
    await esClient.update({
      index: EMAIL_INDEX,
      id,
      doc: updates,
    });
  } catch (error) {
    console.warn('⚠️  ES update failed:', (error as Error).message);
  }
}

export async function searchEmailJobs(query: string, userId: string): Promise<string[]> {
  try {
    const result = await esClient.search({
      index: EMAIL_INDEX,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['subject^2', 'body', 'recipientEmail', 'senderEmail'],
              },
            },
          ],
          filter: [{ term: { userId } }],
        },
      },
      size: 100,
    });
    return result.hits.hits.map((hit) => hit._id as string);
  } catch (error) {
    console.warn('⚠️  ES search failed:', (error as Error).message);
    return [];
  }
}

/**
 * Bulk index multiple email jobs at once (much faster for campaigns)
 */
export async function indexEmailJobsBulk(docs: Array<{
  id: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  sentAt?: Date | null;
  status: string;
  campaignId?: string | null;
  createdAt: Date;
}>): Promise<void> {
  if (docs.length === 0) return;

  try {
    const operations = docs.flatMap((doc) => [
      { index: { _index: EMAIL_INDEX, _id: doc.id } },
      {
        ...doc,
        scheduledAt: doc.scheduledAt.toISOString(),
        sentAt: doc.sentAt?.toISOString() ?? null,
        createdAt: doc.createdAt.toISOString(),
      },
    ]);

    const result = await esClient.bulk({ operations, refresh: false });
    if (result.errors) {
      const errored = result.items.filter((i) => i.index?.error);
      console.warn(`⚠️  ES bulk index had ${errored.length} errors`);
    }
  } catch (error) {
    console.warn('⚠️  ES bulk indexing failed:', (error as Error).message);
  }
}

