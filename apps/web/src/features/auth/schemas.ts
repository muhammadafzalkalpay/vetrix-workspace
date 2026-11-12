import { z } from "zod";

const email = z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address.");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters.").max(128, "Use 128 characters or fewer."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match." });

export type SignInValues = z.infer<typeof signInSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
