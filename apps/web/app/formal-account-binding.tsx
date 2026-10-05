"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";

const FORMAL_USER_ID = "e2817803-1304-4ef0-b0b8-66f473b12886";
const FORMAL_NAME = "孤星企鵝";

export function FormalAccountBinding() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    if (pathname.startsWith("/admin")) return () => { alive = false; };
    void (async () => {
      const session = await supabase.auth.getSession();
      if (session.data.session?.user?.id !== FORMAL_USER_ID) return;
      const profile = await supabase.from("profiles").select("id, anonymous_display_name").eq("id", FORMAL_USER_ID).maybeSingle();
      if (alive && profile.data?.anonymous_display_name === FORMAL_NAME) setVisible(true);
    })();
    return () => { alive = false; };
  }, [pathname]);

  if (pathname.startsWith("/admin") || !visible) return null;
  return <div style={{position:"fixed",left:72,right:72,bottom:76,zIndex:40,display:"flex",justifyContent:"space-between",gap:12,pointerEvents:"none"}}><a href="/signup" style={{pointerEvents:"auto",display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:36,padding:"0 12px",borderRadius:12,background:"#5e5c62",border:"1px solid rgba(255,255,255,.28)",color:"#fff",fontSize:13,fontWeight:700,textDecoration:"none",boxShadow:"0 4px 12px rgba(0,0,0,.2)",whiteSpace:"nowrap"}}>申請帳號</a><a href="/login" style={{pointerEvents:"auto",display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:36,padding:"0 12px",borderRadius:12,background:"#f08a2b",border:"1px solid rgba(255,210,150,.55)",color:"#24120c",fontSize:13,fontWeight:700,textDecoration:"none",boxShadow:"0 4px 12px rgba(0,0,0,.22)",whiteSpace:"nowrap"}}>登入既有帳號</a></div>;
}
