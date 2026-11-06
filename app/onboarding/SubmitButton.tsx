"use client";
import { useFormStatus } from "react-dom";

// Disabled while the form saves, so a double tap can't submit twice.
export default function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-ink" disabled={pending} aria-busy={pending}>{pending ? "Setting up…" : children}</button>;
}
