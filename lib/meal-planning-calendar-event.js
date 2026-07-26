const FormData = require('form-data');
const uuid = require('./uuid');

/// <reference path="./meal-planning-calendar-label.js" />
/// <reference path="./recipe.js" />

function formatLocalDate(date) {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
}

function parseDate(date) {
	if (date instanceof Date) {
		return date;
	}

	if (typeof date === 'string') {
		const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
		if (dateOnly) {
			const year = Number(dateOnly[1]);
			const month = Number(dateOnly[2]) - 1;
			const day = Number(dateOnly[3]);
			const parsed = new Date(year, month, day);
			return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day
				? parsed
				: new Date(Number.NaN);
		}

		return new Date(date);
	}

	return null;
}

/**
 * Meal Planning Calendar Event class.
 * @class
 *
 * @param {object} event event
 * @param {object[]} labels labels
 * @param {object} context context
 *
 * @property {string} identifier
 * @property {string} calendarId
 * @property {Date|null} date null when the event is in the Meal Plan Queue
 * @property {string=} details
 * @property {number=} eventType 1 for a Meal Plan Queue event
 * @property {string=} labelId
 * @property {MealPlanningCalendarEventLabel=} label
 * @property {number=} logicalTimestamp
 * @property {number=} orderAddedSortIndex
 * @property {string=} recipeId
 * @property {Recipe=} recipe
 * @property {number=} recipeScaleFactor
 * @property {string=} title
 */
class MealPlanningCalendarEvent {
	/**
   * @hideconstructor
   */
	constructor(event, {client, protobuf, uid, calendarId}) {
		this.identifier = event.identifier || uuid();
		if (typeof event.date === 'string' || event.date instanceof Date) {
			this.date = parseDate(event.date);
		} else if (Object.prototype.hasOwnProperty.call(event, 'date')) {
			this.date = null;
		} else {
			this.date = new Date();
		}

		this.details = event.details;
		this.eventType = event.eventType;
		this.labelId = event.labelId;
		this.labelSortIndex = event.labelSortIndex;
		this.logicalTimestamp = event.logicalTimestamp;
		this.orderAddedSortIndex = event.orderAddedSortIndex;
		this.recipeId = event.recipeId;
		this.recipeScaleFactor = event.recipeScaleFactor;
		this.title = event.title;
		this.recipe = null;
		this.label = null;

		this._client = client;
		this._protobuf = protobuf;
		this._uid = uid;
		this._isNew = !event.identifier;
		this._calendarId = calendarId;
	}

	get isQueued() {
		return this.date === null;
	}

	toJSON() {
		return {
			identifier: this.identifier,
			logicalTimestamp: this.logicalTimestamp,
			calendarId: this._calendarId,
			date: this.date,
			isQueued: this.isQueued,
			eventType: this.eventType,
			title: this.title,
			details: this.details,
			recipeId: this.recipeId,
			labelId: this.labelId,
			orderAddedSortIndex: this.orderAddedSortIndex,
			labelSortIndex: this.labelSortIndex,
			recipeScaleFactor: this.recipeScaleFactor,
		};
	}

	_encode() {
		if (this.date !== null && (!(this.date instanceof Date) || Number.isNaN(this.date.getTime()))) {
			throw new TypeError('Meal planning event date must be a valid Date or null');
		}

		return new this._protobuf.PBCalendarEvent({
			identifier: this.identifier,
			logicalTimestamp: this.logicalTimestamp,
			calendarId: this._calendarId,
			date: this.date === null ? undefined : formatLocalDate(this.date), // Only date, no time
			eventType: this.eventType,
			title: this.title,
			details: this.details,
			recipeId: this.recipeId,
			labelId: this.labelId,
			orderAddedSortIndex: this.orderAddedSortIndex,
			labelSortIndex: this.labelSortIndex,
			recipeScaleFactor: this.recipeScaleFactor,
		});
	}

	/**
	 * Build a calendar operation.
	 * @private
	 * @param {string} handlerId - Handler ID for the operation
	 * @returns {PBCalendarOperation} encoded calendar operation
	 */
	_createOperation(handlerId) {
		const op = new this._protobuf.PBCalendarOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId,
			userId: this._uid,
		});

		op.setCalendarId(this._calendarId);
		op.setUpdatedEvent(this._encode());
		if (this.eventType !== null && this.eventType !== undefined) {
			op.setEventType(this.eventType);
		}

		return op;
	}

	/**
	 * Perform a calendar operation.
	 * @private
	 * @param {string} handlerId - Handler ID for the operation
	 * @returns {Promise} promise representing the operation result
	 */
	async performOperation(handlerId) {
		const ops = new this._protobuf.PBCalendarOperationList();
		const op = this._createOperation(handlerId);
		ops.setOperations([op]);

		const form = new FormData();

		form.append('operations', ops.toBuffer());
		await this._client.post('data/meal-planning-calendar/update', {
			body: form,
		});
	}

	/**
	 * Save local changes to the calendar event to AnyList's API.
	 * @return {Promise}
	 */
	async save() {
		const operation = this._isNew ? 'new-event' : 'set-event-details';
		await this.performOperation(operation);
		this._isNew = false;
	}

	/**
	 * Schedule this event on a calendar date.
	 * @param {Date|string} date date or YYYY-MM-DD string
	 * @return {Promise}
	 */
	async schedule(date) {
		const scheduledDate = parseDate(date);
		if (!(scheduledDate instanceof Date) || Number.isNaN(scheduledDate.getTime())) {
			throw new TypeError('Meal planning event date must be a valid Date or date string');
		}

		const previousDate = this.date;
		const previousEventType = this.eventType;
		this.date = scheduledDate;
		this.eventType = 0;
		try {
			await this.save();
		} catch (error) {
			this.date = previousDate;
			this.eventType = previousEventType;
			throw error;
		}
	}

	/**
	 * Move this event into the Meal Plan Queue.
	 * @return {Promise}
	 */
	async moveToQueue() {
		const previousDate = this.date;
		const previousEventType = this.eventType;
		this.date = null;
		this.eventType = 1;
		try {
			await this.save();
		} catch (error) {
			this.date = previousDate;
			this.eventType = previousEventType;
			throw error;
		}
	}

	/**
	 * Delete this event from the calendar via AnyList's API.
	 * @return {Promise}
	 */
	async delete() {
		await this.performOperation('delete-event');
	}
}

module.exports = MealPlanningCalendarEvent;
