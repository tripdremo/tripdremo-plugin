import { z } from "zod";

const childSchema = z.object({
  age: z.number().int().min(0).max(17).describe("Child age in whole years, from 0 through 17."),
}).strict();
export const planRequestFields = {
  prompt: z.string().min(1).max(4_000).describe("Natural-language trip request and priorities."),
  origin: z.string().max(255).default("").describe("Optional trip origin, up to 255 characters; an empty string lets Tripdremo infer it."),
  destination: z.string().max(255).default("").describe("Optional destination, up to 255 characters; an empty string lets Tripdremo infer it from the prompt."),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Trip start date in YYYY-MM-DD format."),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Trip end date in YYYY-MM-DD format; must not precede start_date."),
  adults: z.number().int().min(1).max(12).default(2).describe("Number of adult travellers, from 1 through 12."),
  children: z.array(childSchema).max(12).default([]).describe("Up to 12 child travellers, each represented by an age in whole years."),
  style: z.enum(["relaxed", "balanced", "active", "camper", "luxury"]).default("balanced")
    .describe("Preferred itinerary pace and travel style."),
  budget: z.enum(["value", "comfortable", "premium"]).default("comfortable")
    .describe("Preferred trip budget tier."),
  constraints: z.record(z.string(), z.unknown()).default({})
    .describe("Free-form JSON object containing dietary, mobility, transport, or other trip constraints."),
};
export const planRequestSchema = z.object(planRequestFields).strict();
