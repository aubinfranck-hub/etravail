import { createNotification, listNotifications, unreadNotificationCount, markNotificationRead as markRead } from "../repositories/notificationRepository.js";
import { sendPaidSms } from "./smsService.js";

export function getNotifications(userId:string){ return listNotifications(userId); }
export function getUnreadNotificationCount(userId:string){ return unreadNotificationCount(userId); }
export function markNotificationRead(id:string,userId:string){ return markRead(id,userId); }
export async function notify(input:{userId:string;caseId?:string;channel:string;subject:string;body:string}){
  if(!["IN_APP","EMAIL","SMS"].includes(input.channel)) throw new Error("INVALID_CHANNEL");
  const notification=await createNotification(input);
  if(input.channel==="SMS"){
    try{
      await sendPaidSms({userId:input.userId,notificationId:notification.id,body:`${input.subject} — ${input.body}`});
      return {...notification,sms_status:"SENT"};
    }catch(error){
      return {...notification,sms_status:"NOT_SENT",sms_error:error instanceof Error?error.message:"SMS_FAILED"};
    }
  }
  return notification;
}
