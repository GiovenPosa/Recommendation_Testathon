export const PREDEFINED_TAGS = [
  { id: 1, tag: 'Adventure', searchText: 'adventure thrill hiking trekking' },
  { id: 2, tag: 'Relaxing', searchText: 'relax spa unwind chill' },
  { id: 3, tag: 'Romantic', searchText: 'romantic couple honeymoon love' },
  { id: 4, tag: 'Family', searchText: 'family kids children child-friendly' },
  { id: 5, tag: 'Solo', searchText: 'solo self solo travel alone' },
  { id: 6, tag: 'Group', searchText: 'group friends together team' },
  { id: 7, tag: 'Budget', searchText: 'budget cheap low-cost backpack' },
  { id: 8, tag: 'Luxury', searchText: 'luxury premium five-star high-end' },
  { id: 9, tag: 'Road Trip', searchText: 'road trip car drive scenic' },
  { id: 10, tag: 'Weekend Getaway', searchText: 'weekend short quick escape' },
  { id: 11, tag: 'Digital Nomad', searchText: 'remote work nomad laptop' },
  { id: 12, tag: 'Beach', searchText: 'beach sand sea ocean coast' },
  { id: 13, tag: 'Mountains', searchText: 'mountain hiking climb altitude' },
  { id: 14, tag: 'Forest', searchText: 'forest jungle green nature' },
  { id: 15, tag: 'Desert', searchText: 'desert sand dunes camel' },
  { id: 16, tag: 'National Parks', searchText: 'parks nature wildlife protected' },
  { id: 17, tag: 'Wildlife Safari', searchText: 'safari animals wildlife africa' },
  { id: 18, tag: 'Hiking', searchText: 'hike trekking trails boots' },
  { id: 19, tag: 'Camping', searchText: 'camping tents outdoors bonfire' },
  { id: 20, tag: 'City Break', searchText: 'city break urban sightseeing' },
  { id: 21, tag: 'Nightlife', searchText: 'nightlife bars clubs party' },
  { id: 22, tag: 'Historic Sites', searchText: 'historic ruins landmarks monuments' },
  { id: 23, tag: 'Cultural', searchText: 'culture heritage traditions museums' },
  { id: 24, tag: 'Architecture', searchText: 'buildings design architecture' },
  { id: 25, tag: 'Street Art', searchText: 'graffiti murals art city' },
  { id: 26, tag: 'Foodie', searchText: 'foodie cuisine eats streetfood' },
  { id: 27, tag: 'Shopping', searchText: 'shopping fashion stores market' },
  { id: 28, tag: 'Wellness', searchText: 'wellness retreat balance self-care' },
  { id: 29, tag: 'Spa', searchText: 'spa massage relax luxury' },
  { id: 30, tag: 'Yoga Retreat', searchText: 'yoga wellness spiritual fitness' },
  { id: 31, tag: 'Photography', searchText: 'camera photo travel shots' },
  { id: 32, tag: 'Festival', searchText: 'festival seasonal music carnival celebration' },
  { id: 33, tag: 'Party', searchText: 'party nightlife clubbing fun' },
  { id: 34, tag: 'Summer', searchText: 'summer seasonal hot sunny beach' },
  { id: 35, tag: 'Winter', searchText: 'winter seasonal snow ski christmas' },
  { id: 36, tag: 'Spring', searchText: 'spring seasonal flowers cherry blossom' },
  { id: 37, tag: 'Autumn', searchText: 'autumn seasonal fall foliage leaves' },
  { id: 38, tag: 'Christmas', searchText: 'christmas seasonal market lights december' },
  { id: 39, tag: 'New Year', searchText: 'new year seasonal celebration fireworks' },
  { id: 40, tag: 'Asia', searchText: 'asia japan thailand bali' },
  { id: 41, tag: 'Europe', searchText: 'europe france italy greece' },
  { id: 42, tag: 'Africa', searchText: 'africa morocco kenya safari' },
  { id: 43, tag: 'Americas', searchText: 'usa canada mexico brazil' },
  { id: 44, tag: 'Oceania', searchText: 'australia new zealand' },
  { id: 45, tag: 'Middle East', searchText: 'dubai jordan israel' },
  { id: 46, tag: 'Eco Travel', searchText: 'eco sustainable green travel conscious ethical' },
  { id: 47, tag: 'Volunteering', searchText: 'volunteer charity community help purpose' },
  { id: 48, tag: 'Pet-Friendly', searchText: 'pet dog cat animal-friendly travel with pets' },
  { id: 49, tag: 'Mediterranean', searchText: 'italy greece sea voyage culture luxury' },
  { id: 50, tag: 'Workation', searchText: 'workation remote work business leisure bleisure' },
  { id: 51, tag: 'Creative Retreat', searchText: 'creative writing art retreat journaling photography' },
  { id: 52, tag: 'Spiritual', searchText: 'spiritual retreat mindfulness meditation healing' },
  { id: 53, tag: 'Cruise', searchText: 'cruise ship sea voyage sailing luxury' },
  { id: 55, tag: 'Island Hopping', searchText: 'island hopping boat beach tropical ferry' },
  { id: 56, tag: 'Extreme Sports', searchText: 'extreme bungee skydiving adrenaline surf' },
  { id: 57, tag: 'Water Sports', searchText: 'surfing diving snorkel kayaking paddleboard' },
  { id: 58, tag: 'Ski & Snowboard', searchText: 'ski snowboarding slopes alpine winter' },
  { id: 59, tag: 'Language Learning', searchText: 'language immersion learning spanish french school' },
  { id: 60, tag: 'Cooking Class', searchText: 'cooking culinary food class lesson local' },
  { id: 61, tag: 'Film Locations', searchText: 'movie filming scenes tv show set' },
  { id: 62, tag: 'Literary Travel', searchText: 'books authors literature historic libraries' },
  { id: 63, tag: 'Study Abroad', searchText: 'study abroad erasmus university student exchange' },

];

export const formatTagDisplay = (tag) => {
  return `${tag.tag}`;
};

export const searchTags = (searchTerm) => {
  if (!searchTerm.trim()) return PREDEFINED_TAGS;
  
  const term = searchTerm.toLowerCase().trim();
  return PREDEFINED_TAGS.filter(tag => 
    tag.searchText.includes(term)
  );
};