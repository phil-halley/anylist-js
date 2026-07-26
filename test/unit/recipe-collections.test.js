const {expect} = require('chai');
const AnyList = require('../../lib');

function createClient() {
	const client = new AnyList({
		email: 'test@example.com',
		password: 'test',
		credentialsFile: null,
	});

	client.uid = 'user-1';
	client._userData = {
		recipeDataResponse: {
			recipeDataId: 'recipe-data-1',
			recipes: [{identifier: 'recipe-1', name: 'Soup'}],
			recipeCollections: [{
				identifier: 'collection-1',
				name: 'Weeknight',
				recipeIds: ['recipe-1'],
			}],
		},
		mealPlanningCalendarResponse: {
			calendarId: 'calendar-1',
			events: [],
			labels: [],
		},
	};

	return client;
}

describe('recipe collections', () => {
	it('loads collections alongside recipes with the recipe data context', async () => {
		const client = createClient();

		await client.getRecipes(false);

		expect(client.recipeCollections).to.have.lengthOf(1);
		expect(client.recipeCollections[0].name).to.equal('Weeknight');
		expect(client.recipeCollections[0].recipeDataId).to.equal('recipe-data-1');
		expect(client.recipes[0].recipeDataId).to.equal('recipe-data-1');
	});

	it('loads and finds collections by identifier or name', async () => {
		const client = createClient();

		const collections = await client.getRecipeCollections(false);

		expect(collections).to.have.lengthOf(1);
		expect(client.getRecipeCollectionById('collection-1')).to.equal(collections[0]);
		expect(client.getRecipeCollectionByName('Weeknight')).to.equal(collections[0]);
	});

	it('uses create then update handlers when saving a collection', async () => {
		const client = createClient();
		await client.getRecipeCollections(false);
		const collection = client.createRecipeCollection({name: 'New collection'});
		const handlers = [];
		collection.performOperation = async handlerId => handlers.push(handlerId);

		await collection.save();
		collection.name = 'Renamed collection';
		await collection.save();

		expect(handlers).to.deep.equal(['new-recipe-collection', 'save-recipe-collection']);
	});

	it('updates membership before encoding and ignores duplicate additions', async () => {
		const client = createClient();
		const [collection] = await client.getRecipeCollections(false);
		const operations = [];
		collection.performOperation = async handlerId => {
			operations.push({handlerId, recipeIds: [...collection.recipeIds]});
		};

		await collection.addRecipe('recipe-1');
		await collection.addRecipe('recipe-2');
		await collection.removeRecipe('recipe-1');

		expect(operations).to.deep.equal([
			{handlerId: 'add-recipes-to-collection', recipeIds: ['recipe-1', 'recipe-2']},
			{handlerId: 'remove-recipes-from-collection', recipeIds: ['recipe-2']},
		]);
	});

	it('includes the collection identifier when encoding deletion', async () => {
		const client = createClient();
		const [collection] = await client.getRecipeCollections(false);

		const operation = collection._createOperation('remove-recipe-collection');

		expect(operation.recipeCollectionIds).to.deep.equal(['collection-1']);
	});
});
