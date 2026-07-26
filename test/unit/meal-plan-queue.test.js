const {expect} = require('chai');
const AnyList = require('../../lib');

function createClient() {
	const client = new AnyList({
		email: 'test@example.com',
		password: 'test',
		credentialsFile: null,
	});

	client.uid = 'user-1';
	client.calendarId = 'calendar-1';
	client._userData = {
		recipeDataResponse: {
			recipeDataId: 'recipe-data-1',
			recipes: [{identifier: 'recipe-1', name: 'Soup'}],
			recipeCollections: [],
		},
		mealPlanningCalendarResponse: {
			calendarId: 'calendar-1',
			events: [
				{identifier: 'queue-1', date: null, recipeId: 'recipe-1', title: 'Soup'},
				{identifier: 'dated-1', date: '2026-08-02', title: 'Tacos'},
			],
			labels: [],
		},
	};

	return client;
}

describe('Meal Plan Queue', () => {
	it('preserves null dates and filters queue events', async () => {
		const client = createClient();

		const queue = await client.getMealPlanQueue(false);

		expect(queue).to.have.lengthOf(1);
		expect(queue[0].identifier).to.equal('queue-1');
		expect(queue[0].date).to.equal(null);
		expect(queue[0].isQueued).to.equal(true);
		expect(queue[0].recipe.name).to.equal('Soup');
	});

	it('creates queue events with an omitted protobuf date', async () => {
		const client = createClient();

		const event = await client.createMealPlanQueueEvent({title: 'Soup'});
		const encoded = event._encode();

		expect(event.date).to.equal(null);
		expect(encoded.date).to.equal(null);
	});

	it('parses date-only strings as local calendar dates', async () => {
		const client = createClient();
		const event = await client.createEvent({date: '2026-08-02'});

		expect(event.date.getFullYear()).to.equal(2026);
		expect(event.date.getMonth()).to.equal(7);
		expect(event.date.getDate()).to.equal(2);
		expect(event._encode().date).to.equal('2026-08-02');
	});

	it('adds a recipe to the queue and uses its name as the default title', async () => {
		const client = createClient();
		const calls = [];
		client.createMealPlanQueueEvent = async eventOptions => ({
			eventOptions,
			async save() {
				calls.push('save');
			},
		});

		const event = await client.addRecipeToMealPlanQueue({
			identifier: 'recipe-1',
			name: 'Soup',
		});

		expect(event.eventOptions).to.deep.equal({recipeId: 'recipe-1', title: 'Soup'});
		expect(calls).to.deep.equal(['save']);
	});

	it('schedules queue entries and can move them back to the queue', async () => {
		const client = createClient();
		const [event] = await client.getMealPlanQueue(false);
		const handlers = [];
		event.performOperation = async handlerId => handlers.push(handlerId);

		await event.schedule('2026-08-03');
		expect(event._encode().date).to.equal('2026-08-03');
		expect(event.isQueued).to.equal(false);

		await event.moveToQueue();
		expect(event.date).to.equal(null);
		expect(event.isQueued).to.equal(true);
		expect(handlers).to.deep.equal(['set-event-details', 'set-event-details']);
	});

	it('rejects invalid calendar dates', async () => {
		const client = createClient();
		const [event] = await client.getMealPlanQueue(false);

		let error;
		try {
			await event.schedule('2026-02-30');
		} catch (caught) {
			error = caught;
		}

		expect(error).to.be.instanceOf(TypeError);
		expect(event.date).to.equal(null);
	});

	it('marks newly saved queue events as existing', async () => {
		const client = createClient();
		const event = await client.createMealPlanQueueEvent({title: 'Soup'});
		const handlers = [];
		event.performOperation = async handlerId => handlers.push(handlerId);

		await event.save();
		await event.save();

		expect(handlers).to.deep.equal(['new-event', 'set-event-details']);
	});
});
