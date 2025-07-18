import { CalendarEvent, CalendarEventAttendee, Mail } from "../../../common/api/entities/tutanota/TypeRefs"
import { DateTime } from "../../../../libs/luxon"
import { findAttendeeInAddresses, formatJSDate, isAllDayEvent, isSameExternalEvent } from "../../../common/api/common/utils/CommonCalendarUtils"
import { ParsedIcalFileContentData } from "../../../calendar-app/calendar/view/CalendarInvites"
import { CalendarEventsRepository } from "../../../common/calendar/date/CalendarEventsRepository"
import { CalendarAttendeeStatus, CalendarMethod, SECOND_MS } from "../../../common/api/common/TutanotaConstants"
import m, { Children, ClassComponent, Vnode, VnodeDOM } from "mithril"
import { base64ToBase64Url, clone, filterNull, getHourOfDay, getStartOfDay, isNotEmpty, isNotNull, partition, stringToBase64 } from "@tutao/tutanota-utils"
import {
	EventConflictRenderPolicy,
	TIME_SCALE_BASE_VALUE,
	TimeRange,
	TimeScale,
	TimeScaleTuple,
	TimeView,
	TimeViewAttributes,
	TimeViewEventWrapper,
} from "../../../common/calendar/gui/TimeView"
import { Time } from "../../../common/calendar/date/Time"
import { locator } from "../../../common/api/main/CommonLocator"
import { theme } from "../../../common/gui/theme"
import { styles } from "../../../common/gui/styles"
import { px, size } from "../../../common/gui/size"
import { Icon, IconSize } from "../../../common/gui/base/Icon"
import { BootIcons } from "../../../common/gui/base/icons/BootIcons"
import { lang, Translation } from "../../../common/misc/LanguageViewModel"
import { collidesWith, formatEventTimes, getEventColor } from "../../../calendar-app/calendar/gui/CalendarGuiUtils"
import { Icons } from "../../../common/gui/base/icons/Icons"
import { BannerButton } from "../../../common/gui/base/buttons/BannerButton"
import { ReplyButtons } from "../../../calendar-app/calendar/gui/eventpopup/EventPreviewView"
import { ProgrammingError } from "../../../common/api/common/error/ProgrammingError"
import stream from "mithril/stream"
import { isRepliedTo } from "../../mail/model/MailUtils"
import { EventBannerSkeleton } from "../EventBannerSkeleton"
import type { EventBannerAttrs } from "../../mail/view/EventBanner"

export type EventBannerImplAttrs = Omit<EventBannerAttrs, "iCalContents"> & {
	iCalContents: ParsedIcalFileContentData
	sendResponse: (event: CalendarEvent, recipient: string, status: CalendarAttendeeStatus, previousMail: Mail) => Promise<boolean>
}

export interface InviteAgenda {
	before: TimeViewEventWrapper | null
	after: TimeViewEventWrapper | null
	main: TimeViewEventWrapper
	allDayEvents: Array<TimeViewEventWrapper>
	existingEvent?: CalendarEvent
	conflictCount: number
}

export class EventBannerImpl implements ClassComponent<EventBannerImplAttrs> {
	private agenda: Map<string, InviteAgenda> | null = null

	oncreate({ attrs }: VnodeDOM<EventBannerImplAttrs>) {
		Promise.resolve().then(async () => {
			this.agenda = await loadEventsAroundInvite(attrs.eventsRepository, attrs.iCalContents, attrs.recipient, attrs.groupColors)
			m.redraw()
		})
	}

	view({ attrs: { iCalContents, eventsRepository, groupColors, mail, recipient, sendResponse } }: Vnode<EventBannerImplAttrs>): Children {
		const agenda = this.agenda
		if (!agenda) {
			return m(EventBannerSkeleton)
		}

		const replyCallback = async (event: CalendarEvent, recipient: string, status: CalendarAttendeeStatus, previousMail: Mail) => {
			const responded = await sendResponse(event, recipient, status, previousMail)
			if (responded) {
				this.agenda = await loadEventsAroundInvite(eventsRepository, iCalContents, recipient, groupColors, true)
				updateAttendeeStatusIfNeeded(event, recipient, this.agenda.get(event.uid ?? "")?.existingEvent)
				m.redraw()
			}
			return responded
		}

		const eventsReplySection = iCalContents.events
			.map((event: CalendarEvent): { event: CalendarEvent; replySection: Children } | None => {
				const replySection = this.buildReplySection(agenda, event, mail, recipient, iCalContents.method, replyCallback)
				return replySection == null ? null : { event, replySection }
			})
			// thunderbird does not add attendees to rescheduled instances when they were added during an "all event"
			// edit operation, but _will_ send all the events to the participants in a single file. we do not show the
			// banner for events that do not mention us.
			.filter(isNotNull)

		return eventsReplySection.map(({ event, replySection }) => {
			return this.buildEventBanner(event, agenda.get(event.uid ?? "") ?? null, replySection)
		})
	}

	private buildEventBanner(event: CalendarEvent, agenda: InviteAgenda | null, replySection: Children) {
		if (!agenda) {
			console.warn(`Trying to render an EventBanner for event ${event._id} but it doesn't have an agenda. Something really wrong happened.`)
		}
		const hasConflict = Boolean(agenda?.conflictCount! > 0)
		const events = filterNull([agenda?.before, agenda?.main, agenda?.after])

		let eventFocusBound = agenda?.main.event?.startTime!
		let shortestTimeFrame: number = this.findShortestDuration(event, event) // In this case we just get the event duration and later reevaluate
		if (agenda?.before) {
			shortestTimeFrame = this.findShortestDuration(agenda.main.event, agenda.before.event)
		}
		if (!agenda?.before && agenda?.after) {
			if (!agenda?.before?.conflictsWithMainEvent && agenda?.after?.conflictsWithMainEvent) {
				eventFocusBound = agenda.after.event.startTime
			}
			shortestTimeFrame = this.findShortestDuration(agenda.main.event, agenda.after.event)
		}

		const timeScale = this.getTimeScaleAccordingToEventDuration(shortestTimeFrame)

		const timeInterval = TIME_SCALE_BASE_VALUE / timeScale
		const timeRangeStart = Time.fromDate(eventFocusBound).sub({ minutes: timeInterval })
		const timeRangeStartEnd = Time.fromDate(eventFocusBound).add({ minutes: timeInterval })
		const timeRange: TimeRange = {
			start: timeRangeStart,
			end: timeRangeStartEnd,
		}

		const isLightTheme = locator.themeController.isLightTheme()
		const bannerColor = isLightTheme ? theme.button_bubble_bg : theme.elevated_bg

		/* Event Banner */
		return m(
			".border-radius-m.border-sm.grid.full-width.mb-s",
			{
				style: styles.isSingleColumnLayout()
					? {
							"grid-template-columns": "min-content 1fr",
							"grid-template-rows": "auto 1fr",
							"max-width": "100%",
							"border-color": bannerColor,
					  }
					: {
							"grid-template-columns": "min-content min-content 1fr",
							"max-width": px(size.two_column_layout_width),
							"border-color": bannerColor,
					  },
			},
			[
				/* Date Column */
				m(
					".flex.flex-column.center.items-center.pb.pt.justify-center.fill-grid-column",
					{
						class: styles.isSingleColumnLayout() ? "plr-vpad" : "pr-vpad-l pl-vpad-l",
						style: {
							"background-color": bannerColor,
						},
					},
					[
						m("span.normal-font-size", event.startTime.toLocaleString("default", { month: "short" })),
						m("span.big.b.lh-s", event.startTime.getDate().toString().padStart(2, "0")),
						m("span.normal-font-size", event.startTime.toLocaleString("default", { year: "numeric" })),
					],
				),
				/* Invite Column */
				m(".flex.flex-column.plr-vpad.pb.pt.justify-start", [
					m(".flex", [
						m(Icon, {
							icon: BootIcons.Calendar,
							container: "div",
							class: "mr-xsm mt-xxs",
							style: { fill: theme.content_fg },
							size: IconSize.Medium,
						}),
						m("span.b.h5.text-ellipsis-multi-line", event.summary),
					]),
					event.organizer?.address
						? m(".flex.items-center.small.mt-s", [
								m("span.b", lang.get("when_label")),
								m("span.ml-xsm", formatEventTimes(getStartOfDay(event.startTime), event, "")),
						  ])
						: null,
					replySection,
				]),
				/* Time Overview */
				m(
					".flex.flex-column.plr-vpad.pb.pt.justify-start",
					{
						class: styles.isSingleColumnLayout() ? "border-sm border-left-none border-right-none border-bottom-none" : "border-left-sm",
						style: {
							"border-color": bannerColor,
						},
					},
					[
						m(".flex.flex-column.mb-s", [
							m(".flex", [
								m(Icon, {
									icon: Icons.Time,
									container: "div",
									class: "mr-xsm mt-xxs",
									style: { fill: theme.content_fg },
									size: IconSize.Medium,
								}),
								m("span.b.h5", lang.get("timeOverview_title")),
							]),
							agenda
								? m(".flex.items-center.mt-hpad-small", [
										m(Icon, {
											icon: hasConflict ? Icons.AlertCircle : Icons.CheckCircleFilled,
											container: "div",
											class: "mr-xsm",
											style: { fill: hasConflict ? theme.error_color : theme.success_color },
											size: IconSize.Medium,
										}),
										this.renderConflictInfoText(agenda.conflictCount, agenda.allDayEvents),
								  ])
								: null,
						]),
						agenda
							? m(TimeView, {
									events: this.filterOutOfRangeEvents(timeRange, events, eventFocusBound, timeInterval),
									timeScale,
									timeRange,
									conflictRenderPolicy: EventConflictRenderPolicy.PARALLEL,
									dates: [getStartOfDay(agenda.main.event.startTime)],
									timeIndicator: Time.fromDate(agenda.main.event.startTime),
									hasAnyConflict: hasConflict,
							  } satisfies TimeViewAttributes)
							: m("", "ERROR: Could not load the agenda for this day."),
					],
				),
			],
		)
	}

	private renderConflictInfoText(conflictCount: number, allDayEvents: Array<TimeViewEventWrapper>) {
		const hasOnlyAllDayConflicts = conflictCount > 0 && conflictCount === allDayEvents.length
		return m(
			".small.flex.gap-vpad-xs-15.items-center",
			{
				style: {
					"line-height": px(19.5),
				},
			},
			[
				!hasOnlyAllDayConflicts
					? m(
							"span",
							conflictCount > 0 ? [m("strong", conflictCount), ` ${lang.get("simultaneousEvents_msg")}`] : lang.get("noSimultaneousEvents_msg"),
					  )
					: null,
				isNotEmpty(allDayEvents)
					? m("span.border-radius.button-bubble-bg.pt-xxs.pb-xxs.plr-sm.text-break", [
							m("strong", allDayEvents.length === 1 ? `1 ${lang.get("allDay_label").toLowerCase()}: ` : `${allDayEvents.length} `),
							allDayEvents.length === 1 ? allDayEvents[0].event.summary : lang.get("allDay_label").toLowerCase(),
					  ])
					: null,
			],
		)
	}

	private buildReplySection(
		agenda: Map<string, InviteAgenda>,
		event: CalendarEvent,
		mail: Mail,
		recipient: string,
		method: CalendarMethod,
		sendResponse: EventBannerImplAttrs["sendResponse"],
	): Children {
		const shallowEvent = agenda.get(event.uid ?? "")?.existingEvent
		const ownAttendee: CalendarEventAttendee | null = findAttendeeInAddresses(shallowEvent?.attendees ?? event.attendees, [recipient])

		const children: Children = []
		const viewOnCalendarButton = m(BannerButton, {
			borderColor: theme.content_fg,
			color: theme.content_fg,
			click: () => this.handleViewOnCalendarAction(agenda, event),
			text: {
				testId: "",
				text: lang.get("viewOnCalendar_action"),
			} as Translation,
		})

		if (method === CalendarMethod.REQUEST && ownAttendee != null) {
			// some mails contain more than one event that we want to be able to respond to
			// separately.

			const needsAction =
				!isRepliedTo(mail) ||
				ownAttendee.status === CalendarAttendeeStatus.NEEDS_ACTION ||
				(isRepliedTo(mail) && ownAttendee.status === CalendarAttendeeStatus.DECLINED)
			if (needsAction) {
				children.push(
					m(ReplyButtons, {
						ownAttendee,
						setParticipation: async (status: CalendarAttendeeStatus) => {
							sendResponse(shallowEvent ?? event, recipient, status, mail)
						},
					}),
				)
			} else if (!needsAction) {
				children.push(m(".align-self-start.start.small.mt-s.mb-xsm-15", lang.get("alreadyReplied_msg")))
				children.push(viewOnCalendarButton)
			}
		} else if (method === CalendarMethod.REPLY) {
			children.push(m(".pt.align-self-start.start.small", lang.get("eventNotificationUpdated_msg")))
			children.push(viewOnCalendarButton)
		} else {
			return null
		}

		return children
	}

	private handleViewOnCalendarAction(agenda: Map<string, InviteAgenda>, event: CalendarEvent) {
		const currentEvent = agenda.get(event.uid ?? "")?.existingEvent
		if (!currentEvent) {
			throw new ProgrammingError("Missing corresponding event in calendar")
		}
		const eventDate = formatJSDate(currentEvent.startTime)
		const eventId = base64ToBase64Url(stringToBase64(currentEvent._id.join("/")))
		m.route.set(`/calendar/agenda/${eventDate}/${eventId}`)
	}

	private findShortestDuration(a: CalendarEvent, b: CalendarEvent): number {
		const durationA = getDurationInMinutes(a)
		const durationB = getDurationInMinutes(b)
		return durationA < durationB ? durationA : durationB
	}

	private filterOutOfRangeEvents(range: TimeRange, events: Array<TimeViewEventWrapper>, baseDate: Date, timeInterval: number): Array<TimeViewEventWrapper> {
		const rangeStartDate = range.start.toDate(baseDate)
		const rangeEndDate = clone(range.end).add({ minutes: timeInterval }).toDate(baseDate)

		return events.flatMap((event) => {
			if (
				(event.event.endTime > rangeStartDate && event.event.endTime <= rangeEndDate) || // Ends during event
				(event.event.startTime >= rangeStartDate && event.event.startTime < rangeEndDate) || // Starts during event
				(event.event.startTime <= rangeStartDate && event.event.endTime >= rangeEndDate)
			) {
				// Overlaps range
				return [event]
			}

			return []
		})
	}

	/**
	 * @param eventDuration - Duration in minutes
	 * @private
	 */
	private getTimeScaleAccordingToEventDuration(eventDuration: number): TimeScale {
		const scalesInMinutes: Array<TimeScaleTuple> = [
			[1, TIME_SCALE_BASE_VALUE],
			[2, TIME_SCALE_BASE_VALUE / 2],
			[4, TIME_SCALE_BASE_VALUE / 4],
		]
		const entry = scalesInMinutes.reduce((smallestScale, currentScale) => {
			const [scale, scaleInMinutes] = currentScale
			if (eventDuration <= scaleInMinutes) return currentScale
			return smallestScale
		}, scalesInMinutes[0])
		return (entry ? entry[0] : 1) as TimeScale
	}
}

export async function loadEventsAroundInvite(
	eventsRepository: CalendarEventsRepository,
	iCalContents: ParsedIcalFileContentData,
	recipient: string,
	groupColors: Map<Id, string>,
	forceReload: boolean = false,
) {
	/*
	 * - Load events that occurs on the same day as event start/end, load both because an event can start at one day and ends in another
	 * - Extract conflicting events following the logic bellow
	 *           [==============] (event)
	 *   [=========] ev.endTime > event.startTime && ev.endTime <= event.endTime
	 *     					[=========] ev.startTime >= event.startTime && ev.startTime < event.endTime
	 *				[========]	ev.startTime >= event.startTime && ev.startTime < event.endTime
	 * [=========]
	 * [==================================] ev.startTime <= event.startTime && ev.endTime >= event.endTime
	 *  						[=========]
	 * - If there's no conflicting before event, get one from event list that starts and ends before the invitation
	 * - If there's no conflicting after event, get one from event list that starts and ends after the invitation
	 * - Build an object that should contain the event before and after, these can be null, meaning that there's no event at the time
	 */
	const eventToAgenda: Map<string, InviteAgenda> = new Map()
	const datesToLoad = iCalContents.events.map((ev) => [getStartOfDay(ev.startTime), getStartOfDay(ev.endTime)]).flat()
	const hasNewPaidPlan = await eventsRepository.canLoadBirthdaysCalendar()
	if (hasNewPaidPlan) {
		await eventsRepository.loadContactsBirthdays()
	}
	if (forceReload) {
		await eventsRepository.forceLoadEventsAt(datesToLoad)
	} else {
		await eventsRepository.loadMonthsIfNeeded(datesToLoad, stream(false), null)
	}
	const events = eventsRepository.getEventsForMonths()() // Short and long events

	for (const iCalEvent of iCalContents.events) {
		const startOfDay = getStartOfDay(iCalEvent.startTime)
		const endOfDay = getStartOfDay(iCalEvent.endTime)
		const eventsForStartDay = events.get(startOfDay.getTime()) ?? []
		const eventsForEndDay = events.get(endOfDay.getTime()) ?? []
		const allExistingEvents = Array.from(new Set([...eventsForStartDay, ...eventsForEndDay]))

		const currentExistingEvent = allExistingEvents.find((e) => isSameExternalEvent(e, iCalEvent))
		updateAttendeeStatusIfNeeded(iCalEvent, recipient, currentExistingEvent)

		const [allDayAndLongEvents, normalEvents] = partition(allExistingEvents, (ev) => {
			const eventHas24HoursOrMore = getDurationInMinutes(ev) >= 60 * 24
			return isAllDayEvent(ev) || eventHas24HoursOrMore
		})

		const conflictingNormalEvents = normalEvents.filter((ev) => !isSameExternalEvent(ev, iCalEvent) && collidesWith(ev, iCalEvent))

		// Decides if we already have a conflicting event or if we should pick an event from event list that happens before the invitation
		const closestConflictingEventBeforeStartTime = conflictingNormalEvents
			.filter((ev) => ev.startTime <= iCalEvent.startTime)
			.reduce((closest: CalendarEvent | null, ev, index) => {
				if (!closest) return ev
				if (iCalEvent.startTime.getTime() - ev.startTime.getTime() < iCalEvent.startTime.getTime() - closest.startTime.getTime()) return ev
				return closest
			}, null)

		// Decides if we already have a conflicting event or if we should pick an event from event list that happens after the invitation
		const closestConflictingEventAfterStartTime = conflictingNormalEvents
			.filter((ev) => ev.startTime > iCalEvent.startTime)
			.reduce((closest: CalendarEvent | null, ev, index) => {
				if (!closest) return ev
				if (Math.abs(iCalEvent.startTime.getTime() - ev.startTime.getTime()) < Math.abs(iCalEvent.startTime.getTime() - closest.startTime.getTime()))
					return ev
				return closest
			}, null)

		let eventList: InviteAgenda = {
			before: null,
			after: null,
			main: {
				event: iCalEvent,
				conflictsWithMainEvent: false,
				color: theme.success_container_color,
				featured: true,
			},
			allDayEvents: allDayAndLongEvents.map((event) => ({
				event,
				conflictsWithMainEvent: true,
				color: `#${getEventColor(event, groupColors)}`,
				featured: false,
			})),
			existingEvent: currentExistingEvent,
			conflictCount: conflictingNormalEvents.length + allDayAndLongEvents.length,
		}

		const oneHour = SECOND_MS * 3600
		if (!closestConflictingEventBeforeStartTime) {
			const eventBefore = normalEvents
				.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
				.find(
					(ev) =>
						!isSameExternalEvent(ev, iCalEvent) &&
						ev.startTime <= iCalEvent.startTime &&
						iCalEvent.startTime.getTime() - ev.endTime.getTime() <= oneHour,
				)

			if (eventBefore) {
				eventList.before = {
					event: eventBefore,
					conflictsWithMainEvent: false,
					color: `#${getEventColor(eventBefore, groupColors)}`,
					featured: false,
				}
			}
		} else {
			eventList.before = {
				event: closestConflictingEventBeforeStartTime,
				conflictsWithMainEvent: true,
				color: `#${getEventColor(closestConflictingEventBeforeStartTime, groupColors)}`,
				featured: false,
			}
		}

		if (!closestConflictingEventAfterStartTime) {
			const eventAfter = normalEvents
				.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
				.find(
					(ev) =>
						!isSameExternalEvent(ev, iCalEvent) &&
						ev.startTime > iCalEvent.startTime &&
						ev.startTime.getTime() - iCalEvent.endTime.getTime() <= oneHour,
				)

			if (eventAfter) {
				eventList.after = {
					event: eventAfter,
					conflictsWithMainEvent: false,
					color: `#${getEventColor(eventAfter, groupColors)}`,
					featured: false,
				}
			}
		} else {
			const time = getHourOfDay(
				closestConflictingEventAfterStartTime.startTime ?? new Date(),
				closestConflictingEventAfterStartTime.startTime.getHours() ?? 0,
			).getTime()
			eventList.after = {
				event: closestConflictingEventAfterStartTime,
				conflictsWithMainEvent: true,
				color: `#${getEventColor(closestConflictingEventAfterStartTime, groupColors)}`,
				featured: false,
			}
		}

		if (eventList.conflictCount > 0) {
			eventList.main.color = theme.error_container_color
		}
		eventToAgenda.set(iCalEvent.uid ?? "", eventList)
	}

	return eventToAgenda
}

function getDurationInMinutes(ev: CalendarEvent) {
	return DateTime.fromJSDate(ev.endTime).diff(DateTime.fromJSDate(ev.startTime), "minutes").minutes
}

function updateAttendeeStatusIfNeeded(inviteEvent: CalendarEvent, ownAttendeeAddress: string, existingEvent?: CalendarEvent) {
	if (!existingEvent) {
		return
	}

	const ownAttendee = findAttendeeInAddresses(inviteEvent.attendees, [ownAttendeeAddress])
	const existingOwnAttendee = findAttendeeInAddresses(existingEvent.attendees, [ownAttendeeAddress])
	if (!ownAttendee || !existingOwnAttendee) {
		return
	}

	ownAttendee.status = existingOwnAttendee.status
}
