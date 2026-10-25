import { Suspense } from "react";
import AuthForm from "../AuthForm";
export const metadata = { title: "Log in" };
export default function Page() { return <Suspense><AuthForm mode="login" /></Suspense>; }
