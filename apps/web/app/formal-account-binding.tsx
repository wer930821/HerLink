"use client";
import { usePathname } from "next/navigation";
export function FormalAccountBinding() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return <div style={{position:"fixed",left:16,right:16,bottom:76,zIndex:40,display:"flex",justifyContent:"center",gap:10,pointerEvents:"none"}}><a href="/signup" style={{pointerEvents:"auto",display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:44,padding:"0 20px",borderRadius:14,background:"#5e5c62",border:"1px solid rgba(255,255,255,.28)",color:"#fff",fontSize:15,fontWeight:700,textDecoration:"none",boxShadow:"0 4px 12px rgba(0,0,0,.2)"}}>申請帳號</a><a href="/login" style={{pointerEvents:"auto",display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:44,padding:"0 20px",borderRadius:14,background:"#f08a2b",border:"1px solid rgba(255,210,150,.55)",color:"#24120c",fontSize:15,fontWeight:700,textDecoration:"none",boxShadow:"0 4px 12px rgba(0,0,0,.22)"}}>登入既有帳號</a></div>;
}
