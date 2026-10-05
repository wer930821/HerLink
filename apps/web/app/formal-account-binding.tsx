"use client";
import { usePathname } from "next/navigation";
export function FormalAccountBinding() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return <div style={{position:"static",width:"100%",display:"flex",justifyContent:"center",gap:10,margin:"16px auto 0",padding:"0 16px",boxSizing:"border-box"}}><a href="/signup" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:44,padding:"0 20px",borderRadius:14,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.22)",color:"#fff",fontSize:15,fontWeight:700,textDecoration:"none"}}>申請帳號</a><a href="/login" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:44,padding:"0 20px",borderRadius:14,background:"rgba(255,145,52,.9)",border:"1px solid rgba(255,210,150,.5)",color:"#24120c",fontSize:15,fontWeight:700,textDecoration:"none"}}>登入既有帳號</a></div>;
}
