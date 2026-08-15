import { z } from "zod";

// piasters, integers — parsed from EGP input client-side
export const openShiftSchema = z.object({
  openingFloat: z.number().int().min(0).max(100_000_000),
});

export const closeShiftSchema = z.object({
  shiftId: z.uuid(),
  counted: z.number().int().min(0).max(1_000_000_000),
});
