import { Suspense } from "react";
import AuthForm from "../AuthForm";
export const metadata = { title: "Create account" };
export default function Page() { return <Suspense><AuthForm mode="signup" /></Suspense>; }
