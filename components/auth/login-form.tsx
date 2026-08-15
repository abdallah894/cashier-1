"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signIn, type AuthState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

export function LoginForm() {
  const t = useTranslations("auth");
  // useActionState pairs a Server Action with client-side pending/error
  // state — think of it as Vue's async submit handler + reactive error
  // ref, but wired declaratively into <form action={…}>.
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <Card>
      <CardContent>
        <form action={formAction}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                dir="ltr"
                placeholder="admin@cachier.local"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                dir="ltr"
              />
              {state.error && <FieldError>{t(`errors.${state.error}`)}</FieldError>}
            </Field>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? t("signingIn") : t("signIn")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
