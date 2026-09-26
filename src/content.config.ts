import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const entries = defineCollection({
  loader: glob({
    base: './src/content/entries',
    pattern: '**/*.{md,mdx}',
  }),

  schema: z.object({
    title: z.string(),

    kind: z.enum([
      'file',
      'note',
      'artifact',
    ]),

    format: z.string().optional(),

    fileNo: z.number().int().positive().optional(),

    description: z.string(),

    published: z.coerce.date(),
    updated: z.coerce.date().optional(),

    status: z.enum([
      'open',
      'ongoing',
      'closed',
    ]).default('ongoing'),

    artists: z.array(z.string()).default([]),
    years: z.array(z.number()).default([]),
    labels: z.array(z.string()).default([]),
    scenes: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([]),

    related: z.array(reference('entries')).default([]),

    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  entries,
};
