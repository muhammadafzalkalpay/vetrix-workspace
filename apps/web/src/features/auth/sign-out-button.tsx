"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton(props: Omit<ButtonProps, "onClick">) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      {...props}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace("/sign-in?notice=signed-out");
        router.refresh();
      }}
    >
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
