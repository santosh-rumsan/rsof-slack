import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PresenceEvent {
  slack_id: string;
  presence: string;
  source: string;
  real_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  ts: string;
}

@Injectable()
export class EventsService {
  private subject = new Subject<PresenceEvent>();

  emit(event: PresenceEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<{ data: PresenceEvent }> {
    return this.subject.asObservable().pipe(map((data) => ({ data })));
  }
}
