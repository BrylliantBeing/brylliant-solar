

## `contain` parameter not supported in `find_by_id`, and `contain` results not properly attached to objects

### 1. `find_by_id` doesn't accept a `contain` parameter

The `find_all` method on all managers (Offer, Advertiser, Conversion, Goal) accepts a `contain` parameter to include related models in the response, but `find_by_id` doesn't support it at all. For example, this doesn't work:

```python
offer = api.offers.find_by_id(id=62, contain=['Country'])

```

I'd expect this to work just like `find_all` does — passing `contain` through to the API call.

### 2. When using `contain`, related objects aren't accessible as attributes on the returned model

Even with `find_all`, when you use `contain=['Country']`, the returned Offer objects don't have the contained Country data attached. The related model data should be accessible as a lowercase attribute on the target object. For example:

```python
# find_all with contain
offer = api.offers.find_all(id=62, contain=['Country'])[0]
assert isinstance(offer, Offer)
assert offer.country['id'] == '724'  # Country should be accessible as .country

# find_by_id with contain
offer = api.offers.find_by_id(id=62, contain=['Country'])
assert isinstance(offer, Offer)
assert offer.country['id'] == '724'  # Same here
    
```

**Expected behavior:** When `contain` is used, the primary model (e.g., `Offer`) should be returned as usual, and any contained/related models (e.g., `Country`) should be set as attributes on the returned object, accessible via lowercase name (e.g., `offer.country`).

This applies to `find_by_id` on all model managers: Offer, Advertiser, Conversion, and Goal.

### Note on Country data format

The Country data that comes back from the HasOffers API when included via `contain` has a nested structure (keyed by country code) rather than being a flat dict with `id` at the top level. The Country model needs to handle both formats gracefully.

Note that there may be existing failing tests in the repo unrelated to this task. You are not responsible for making them pass.

You do not have network access and cannot install new dependencies.

You are expected to complete the solution in one turn without asking for feedback or clarification.

