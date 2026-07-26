const fs = require('fs');
const os = require('os');
const path = require('path');
const {expect} = require('chai');
const AnyList = require('../../lib');

function createClient() {
	const client = new AnyList({
		email: 'test@example.com',
		password: 'test',
		credentialsFile: null,
	});

	client.uid = 'user-1';
	client.recipeDataId = 'recipe-data-1';
	return client;
}

describe('Recipe photos', () => {
	it('uploads the browser-compatible multipart fields', async () => {
		const client = createClient();
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anylist-photo-'));
		const photoPath = path.join(directory, 'dinner.avif');
		fs.writeFileSync(photoPath, Buffer.from('offline-image'));
		let request;
		client.client.post = async (endpoint, options) => {
			request = {endpoint, options};
			return {body: Buffer.from('{}')};
		};

		try {
			const result = await client.uploadPhoto(photoPath, {
				photoId: '231159c57f0b4864bf62c741020d2c7e',
			});
			const body = request.options.body.getBuffer().toString('utf8');

			expect(result).to.deep.equal({
				photoId: '231159c57f0b4864bf62c741020d2c7e',
				filename: '231159c57f0b4864bf62c741020d2c7e.jpg',
			});
			expect(request.endpoint).to.equal('data/photos/upload');
			expect(request.options.headers).to.deep.equal({
				accept: 'application/json',
				'x-requested-with': 'XMLHttpRequest',
			});
			expect(body).to.include('name="filename"');
			expect(body).to.include('231159c57f0b4864bf62c741020d2c7e.jpg');
			expect(body).to.include('name="photo"; filename="dinner.avif"');
			expect(body).to.include('Content-Type: image/avif');
			expect(body).to.include('offline-image');
		} finally {
			fs.rmSync(directory, {recursive: true, force: true});
		}
	});

	it('uploads, adds the photo ID, and saves the recipe', async () => {
		const client = createClient();
		const recipe = await client.createRecipe({name: 'Soup', photoIds: ['existing-photo']});
		let saved = false;
		recipe.save = async () => {
			saved = true;
		};
		client.uploadPhoto = async () => ({
			photoId: 'new-photo',
			filename: 'new-photo.jpg',
		});

		const result = await client.addPhotoToRecipe(recipe, '/offline/soup.jpg');

		expect(saved).to.equal(true);
		expect(result.recipe.photoIds).to.deep.equal(['existing-photo', 'new-photo']);
		expect(result.photo.photoId).to.equal('new-photo');
	});

	it('restores local recipe photo IDs when the recipe save fails', async () => {
		const client = createClient();
		const recipe = await client.createRecipe({name: 'Soup', photoIds: ['existing-photo']});
		recipe.save = async () => {
			throw new Error('offline save failure');
		};
		client.uploadPhoto = async () => ({
			photoId: 'orphaned-photo',
			filename: 'orphaned-photo.jpg',
		});

		let error;
		try {
			await client.addPhotoToRecipe(recipe, '/offline/soup.jpg');
		} catch (caught) {
			error = caught;
		}

		expect(error.message).to.equal('offline save failure');
		expect(recipe.photoIds).to.deep.equal(['existing-photo']);
	});
});
