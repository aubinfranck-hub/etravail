import { createNotification, listNotifications, unreadNotificationCount, markNotificationRead as markRead } from "../repositories/notificationRepository.js";

export function getNotifications(userId:string){ return listNotifications(userId); }
export function getUnreadNotificationCount(userId:string){ return unreadNotificationCount(userId); }
export function markNotificationRead(id:string,userId:string){ return markRead(id,userId); }

export async function notify(input:{userId:string;caseId?:string;channel:string;subject:string;body:string}){
  if(!["IN_APP","EMAIL"].includes(input.channel)) throw new Error("INVALID_CHANNEL");
  return createNotification(input);
}
