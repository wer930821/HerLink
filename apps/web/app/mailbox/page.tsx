"use client";
import { useCallback,useEffect,useState,type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { Button, Field, Notice, Surface } from "../../components/ui";

type Thread={id:string;subject:string;category:string;status:string;created_at:string;updated_at:string;user_last_read_at:string|null;admin_last_read_at?:string|null};
type Msg={id:string;thread_id:string;sender_role:"user"|"admin";body:string;created_at:string;attachment_path:string|null;attachment_mime:string|null;attachment_size:number|null};

const MAIL_BUCKET="station-mail";
const ALLOWED_IMAGE_TYPES=new Set(["image/jpeg","image/png","image/webp"]);
const MAX_IMAGE_BYTES=5*1024*1024;

function MailAttachment({path}:{path:string}){
 const [url,setUrl]=useState<string|null>(null);
 useEffect(()=>{let active=true;void supabase.storage.from(MAIL_BUCKET).createSignedUrl(path,3600).then((result: { data: { signedUrl: string } | null })=>{if(active)setUrl(result.data?.signedUrl??null)});return()=>{active=false}},[path]);
 if(!url)return <div className="muted small">照片載入中…</div>;
 return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="信件照片附件" style={{display:"block",maxWidth:"min(100%,420px)",maxHeight:420,objectFit:"contain",borderRadius:14,marginTop:10}}/></a>;
}

export default function MailboxPage(){
 const router=useRouter(); const [view,setView]=useState<"compose"|"inbox">("compose"); const [threads,setThreads]=useState<Thread[]>([]); const [selected,setSelected]=useState<Thread|null>(null);
 const [messages,setMessages]=useState<Msg[]>([]); const [subject,setSubject]=useState(""); const [category,setCategory]=useState("other");
 const [body,setBody]=useState(""); const [reply,setReply]=useState(""); const [replyPhoto,setReplyPhoto]=useState<File|null>(null); const [replyPhotoPreview,setReplyPhotoPreview]=useState<string|null>(null); const [notice,setNotice]=useState<string|null>(null); const [busy,setBusy]=useState(false);
 const [photo,setPhoto]=useState<File|null>(null); const [photoPreview,setPhotoPreview]=useState<string|null>(null);
 const clearPhoto=()=>{if(photoPreview)URL.revokeObjectURL(photoPreview);setPhoto(null);setPhotoPreview(null)};
 useEffect(()=>()=>{if(photoPreview)URL.revokeObjectURL(photoPreview)},[photoPreview]);
 const choosePhoto=(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0]??null;e.target.value="";if(!file)return;if(!ALLOWED_IMAGE_TYPES.has(file.type)){setNotice("照片只支援 JPEG、PNG、WebP。");return}if(file.size>MAX_IMAGE_BYTES){setNotice("照片不可超過 5MB。");return}if(photoPreview)URL.revokeObjectURL(photoPreview);setPhoto(file);setPhotoPreview(URL.createObjectURL(file));setNotice(null)};
 const load=useCallback(async()=>{const {data}=await (supabase as any).from("station_mail_threads").select("*").order("updated_at",{ascending:false});setThreads((data??[]) as Thread[])},[]);
 useEffect(()=>{void load();const c=supabase.channel("user-mailbox-page").on("postgres_changes",{event:"*",schema:"public",table:"station_mail_threads"},()=>void load()).on("postgres_changes",{event:"*",schema:"public",table:"station_mail_messages"},async(payload:any)=>{void load();if(selected){const row=payload.new as {thread_id?:string};if(row?.thread_id===selected.id){const {data}=await (supabase as any).from("station_mail_messages").select("*").eq("thread_id",selected.id).order("created_at");setMessages((data??[]) as Msg[]);await (supabase as any).rpc("station_mail_mark_user_read",{p_thread_id:selected.id})}}}).subscribe();return()=>{void supabase.removeChannel(c)}},[load,selected]);
 const open=async(t:Thread)=>{setSelected(t);const {data}=await (supabase as any).from("station_mail_messages").select("*").eq("thread_id",t.id).order("created_at");setMessages((data??[]) as Msg[]);await (supabase as any).rpc("station_mail_mark_user_read",{p_thread_id:t.id});void load()};
 const send=async()=>{
  if(!subject.trim()||!body.trim())return setNotice("請填寫主旨與內容。");
  setBusy(true);setNotice(null);let uploadedPath:string|null=null;
  try{
   if(photo){
    const {data:{session}}=await supabase.auth.getSession(); const uid=session?.user.id;if(!uid)throw new Error("AUTH");
    const ext=photo.type==="image/png"?"png":photo.type==="image/webp"?"webp":"jpg";
    uploadedPath=`${uid}/${crypto.randomUUID()}.${ext}`;
    const {error:uploadError}=await supabase.storage.from(MAIL_BUCKET).upload(uploadedPath,photo,{contentType:photo.type,upsert:false});
    if(uploadError)throw uploadError;
   }
   const {data,error}=await (supabase as any).rpc("station_mail_send",{p_subject:subject.trim(),p_category:category,p_body:body.trim()});
   if(error)throw error;
   if(uploadedPath&&photo){
    const {error:attachError}=await (supabase as any).rpc("station_mail_attach_photo",{p_thread_id:data,p_attachment_path:uploadedPath,p_attachment_mime:photo.type,p_attachment_size:photo.size});
    if(attachError)throw attachError;
   }
   setSubject("");setBody("");clearPhoto();setNotice("已寄到站長信箱。");await load();
   if(data){const {data:t}=await (supabase as any).from("station_mail_threads").select("*").eq("id",data).single();if(t)void open(t as Thread)}
  }catch{
   if(uploadedPath)void supabase.storage.from(MAIL_BUCKET).remove([uploadedPath]);
   setNotice("寄送失敗，請稍後再試。");
  }finally{setBusy(false)}
 };
 const chooseReplyPhoto=(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0]??null;e.target.value="";if(!file)return;if(!ALLOWED_IMAGE_TYPES.has(file.type)){setNotice("照片只支援 JPEG、PNG、WebP。");return}if(file.size>MAX_IMAGE_BYTES){setNotice("照片不可超過 5MB。");return}if(replyPhotoPreview)URL.revokeObjectURL(replyPhotoPreview);setReplyPhoto(file);setReplyPhotoPreview(URL.createObjectURL(file));setNotice(null)};
 const clearReplyPhoto=()=>{if(replyPhotoPreview)URL.revokeObjectURL(replyPhotoPreview);setReplyPhoto(null);setReplyPhotoPreview(null)};
 const sendReply=async()=>{if(!selected||(!reply.trim()&&!replyPhoto))return;setBusy(true);setNotice(null);let uploadedPath:string|null=null;try{if(replyPhoto){const {data:{session}}=await supabase.auth.getSession();const uid=session?.user.id;if(!uid)throw new Error("AUTH");const ext=replyPhoto.type==="image/png"?"png":replyPhoto.type==="image/webp"?"webp":"jpg";uploadedPath=`${uid}/${crypto.randomUUID()}.${ext}`;const {error}=await supabase.storage.from(MAIL_BUCKET).upload(uploadedPath,replyPhoto,{contentType:replyPhoto.type,upsert:false});if(error)throw error}const {data:messageId,error}=await (supabase as any).rpc("station_mail_user_reply_with_photo",{p_thread_id:selected.id,p_body:reply.trim()||"（照片）",p_attachment_path:uploadedPath,p_attachment_mime:replyPhoto?.type??null,p_attachment_size:replyPhoto?.size??null});if(error)throw error;void messageId;setReply("");clearReplyPhoto();void open(selected)}catch{if(uploadedPath)void supabase.storage.from(MAIL_BUCKET).remove([uploadedPath]);setNotice("回覆失敗，請稍後再試。")}finally{setBusy(false)}};
 if(selected)return <main className="page-shell mailbox-page mailbox-fullscreen mailbox-thread-view"><Surface><Button onClick={()=>setSelected(null)}>返回我的信件</Button><h1>{selected.subject}</h1><div style={{display:"grid",gap:10}}>{messages.map(m=><div key={m.id} style={{padding:12,borderRadius:14,background:m.sender_role==="admin"?"rgba(212,175,55,.14)":"rgba(255,255,255,.06)"}}><strong>{m.sender_role==="admin"?"站長":"我"}</strong><div>{m.body}</div>{m.attachment_path?<MailAttachment path={m.attachment_path}/>:null}<small>{new Date(m.created_at).toLocaleString("zh-TW")}</small></div>)}</div><Field label="回覆"><textarea className="mailbox-input mailbox-textarea" value={reply} onChange={e=>setReply(e.target.value)} maxLength={2000}/></Field><div className="mailbox-photo-field"><div className="mailbox-field-label">照片附件 <span>選填 · 最大 5MB</span></div><label className="mailbox-photo-picker">＋ 選擇照片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseReplyPhoto} hidden/></label>{replyPhotoPreview?<div className="mailbox-photo-preview"><img src={replyPhotoPreview} alt="回覆照片預覽"/><Button variant="secondary" onClick={clearReplyPhoto}>移除照片</Button></div>:null}</div><Button disabled={busy||(!reply.trim()&&!replyPhoto)} onClick={sendReply}>送出回覆</Button>{notice&&<Notice>{notice}</Notice>}</Surface></main>;
 const unreadThreads=threads.filter(t=>t.status==="replied"&&(!t.user_last_read_at||new Date(t.updated_at).getTime()>new Date(t.user_last_read_at).getTime()));
 return <main className="page-shell mailbox-page mailbox-fullscreen mailbox-fixed"><Surface>
 <div className="mailbox-head mailbox-head-compact"><Button variant="link" onClick={()=>router.push("/")}>← 返回首頁</Button><div className="mailbox-title-row"><span className="mailbox-title-icon">✉</span><div><h1>站長信箱</h1><p>有問題、建議或想告訴站長的事，都可以從這裡寄出。</p></div></div></div>
 <div className="mailbox-view-tabs"><button type="button" className={view==="compose"?"active":""} onClick={()=>setView("compose")}>寫信給站長</button><button type="button" className={view==="inbox"?"active":""} onClick={()=>setView("inbox")}>我的信件{unreadThreads.length>0?`（${unreadThreads.length}）`:""}</button></div>
 {view==="compose"?<section className="mailbox-compose-panel">
 <div className="mailbox-category"><div className="mailbox-field-label">信件分類</div><div className="mailbox-category-grid"><button type="button" className={category==="problem"?"active":""} onClick={()=>setCategory("problem")}>問題回報</button><button type="button" className={category==="suggestion"?"active":""} onClick={()=>setCategory("suggestion")}>建議</button><button type="button" className={category==="other"?"active":""} onClick={()=>setCategory("other")}>其他</button></div></div>
 <Field label="主旨"><input className="mailbox-input" value={subject} onChange={e=>setSubject(e.target.value)} maxLength={80}/></Field>
 <Field label="內容"><textarea className="mailbox-input mailbox-textarea" value={body} onChange={e=>setBody(e.target.value)} maxLength={2000}/></Field>
 <div className="mailbox-photo-field"><div className="mailbox-field-label">照片附件 <span>選填 · 最大 5MB</span></div><label className="mailbox-photo-picker">＋ 選擇照片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} hidden/></label>{photoPreview?<div className="mailbox-photo-preview"><img src={photoPreview} alt="照片附件預覽"/><Button variant="secondary" onClick={clearPhoto}>移除照片</Button></div>:null}</div>
 <Button size="lg" disabled={busy} onClick={send}>{busy?"寄送中…":"寄給站長"}</Button>{notice&&<Notice>{notice}</Notice>}
 </section>:<section className="mailbox-inbox-panel">{threads.length===0?<p>目前還沒有信件。</p>:threads.map(t=><div key={t.id} role="button" tabIndex={0} className="mailbox-thread-card" onClick={()=>void open(t)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();void open(t)}}}><strong>{t.subject}</strong><div>{t.status==="replied"?"站長已回覆":t.status==="closed"?"已結束":"等待回覆"} · {new Date(t.updated_at).toLocaleString("zh-TW")}</div></div>)}</section>}
 </Surface></main>
}