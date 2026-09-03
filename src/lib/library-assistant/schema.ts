import { z } from "zod";

export const ASSISTANT_QUESTION_MAX_LENGTH = 500;

export const libraryQuestionSchema = z.object({
  question: z.string().trim().min(1, "Saisissez une question.").max(ASSISTANT_QUESTION_MAX_LENGTH, `La question est limitée à ${ASSISTANT_QUESTION_MAX_LENGTH} caractères.`),
  domain: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(12).default(6),
  provider: z.enum(["extractive", "mock"]).default("extractive"),
}).strict();

export const assistantHistoryIdSchema = z.string().uuid();
export type LibraryQuestion = z.infer<typeof libraryQuestionSchema>;
