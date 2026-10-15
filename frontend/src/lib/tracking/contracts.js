// Nabitouch Live — typed contracts (JSDoc). Mirrors backend/tracking.py (GET /api/tracking/contracts).

/** @typedef {'trip.started'|'location.updated'|'eta.updated'|'trip.delayed'|'practitioner.arrived'|'tracking.paused'|'tracking.resumed'|'tracking.stopped'|'session.started'|'session.ended'|'practitioner.departed'|'visit.completed'} TrackingEventType */

/**
 * @typedef {Object} LocationFix
 * @property {number} lat
 * @property {number} lng
 * @property {number} accuracy  metres
 * @property {number} seq       monotonic per trip
 * @property {string} recordedAt device ISO timestamp (server re-stamps)
 * @property {number=} speed
 * @property {number=} heading
 * @property {boolean=} approximate
 */

/**
 * @typedef {Object} TrackingEvent
 * @property {string} id
 * @property {TrackingEventType} type
 * @property {number} version
 * @property {string} appointmentId
 * @property {string|null} practitionerId
 * @property {string} serverTime
 * @property {Object} payload
 */

/**
 * @typedef {Object} LocationProvider
 * @property {(onFix:(fix:Omit<LocationFix,'seq'>)=>void, onError:(code:'denied'|'unavailable'|'timeout'|'approximate')=>void)=>()=>void} start  returns stop()
 * @property {string} kind
 */

/** @typedef {{ route(origin:{lat:number,lng:number}, dest:{lat:number,lng:number}): Promise<{distanceKm:number,durationMin:number,geometry:Array<{lat:number,lng:number}>,provider:string}> }} RouteProvider */

export const TRACKING_EVENTS = ['trip.started', 'location.updated', 'eta.updated', 'trip.delayed', 'practitioner.arrived', 'tracking.paused', 'tracking.resumed', 'tracking.stopped', 'session.started', 'session.ended', 'practitioner.departed', 'visit.completed'];
export const TRACKING_RULES = { intervalMs: 5000, staleSec: 30, maxAccuracyM: 150 };
