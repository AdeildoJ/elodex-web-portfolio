"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ItensPageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/loja");
  }, [router]);

  return null;
}
