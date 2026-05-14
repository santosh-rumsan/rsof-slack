import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PresenceEvent {
  type: 'presence';
  slack_id: string;
  presence: string;
  source: string;
  real_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  ts: string;
}

export interface StatusEvent {
  type: 'status';
  slack_id: string;
  status_text: string | null;
  status_emoji: string | null;
  real_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  ts: string;
}

export type ActivityEvent = PresenceEvent | StatusEvent;

@Injectable()
export class EventsService {
  private subject = new Subject<ActivityEvent>();

  emit(event: ActivityEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<{ data: ActivityEvent }> {
    return this.subject.asObservable().pipe(map((data) => ({ data })));
  }
}
