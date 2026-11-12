"use client";

// Browser side of Better Auth: calls /api/auth/* on the same origin.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
