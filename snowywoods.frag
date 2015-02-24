// Define all the things!
//==RAY MARCHING CONSTANTS=========================================================
#define EPSILON .001525
#define MAX_VIEW_STEPS 64
#define MAX_SHADOW_STEPS 64
#define OCCLUSION_SAMPLES 6.0
#define OCCLUSION_FACTOR 1.75
#define MAX_DEPTH 15.0
#define FEATURE_BUMP_FACTOR .03
#define GROUND_BUMP_FACTOR .03
#define SMIN_FACTOR 48.15

//==OBJECT CONSTANTS========================================================
#define GROUND_NORMAL vec3(0.0, 1.0, 0.0)
#define GROUND_HEIGHT 1.0

#define TREE_PROP vec3(0., 0.1, .1)
#define TREE_REP vec3(1.0, 0.0, 2.0)

#define TREE_SNOW_PROP vec3(-.015, 0.0965, .0825)
#define TREE_SNOW_REP vec3(1.0, 0.0, 2.0)

#define SNOW_BOTTOM vec3(-0.1,-1.0, 0.1)
#define SNOW_TOP vec3(0.005, -.0, 0.1)
#define SNOW_RAD .1

#define SNOW_BUMP iChannel0
#define TREE_BUMP iChannel1
#define TREE_SNOW_BUMP iChannel2

#define TREE_TEX_SCALE .4
#define SNOW_TEX_SCALE .35
#define TREE_SNOW_TEX_SCALE .45

#define LIGHT_SPREAD .2
#define LIGHT_COLOR vec3(1.0, 1.0, .95)
#define LIGHT_BRIGHT 0.667
#define AMBIENT_COLOR vec3(.6, .6, 1.0)
#define AMBIENT_LIGHT .0125
#define PEN_FACTOR 20.0

//==RENDERING STRUCTURES===========================================================
/*
	A structure for a spotlight.
*/
struct SpotLight
{
	vec3 position, direction;
	vec3 color;
	float brightness;
	float spread;
	float penumbraFactor;
};

/*
	A structure for a less simple material.
*/
struct Material
{
	vec3 color;
	float gloss;
};

//==CAMERA FUNCTIONS================================================================
/*
	TEKF https://www.shadertoy.com/view/XdsGDB
	Set up a camera looking at the scene.
	origin - camera is positioned relative to, and looking at, this point
	dist - how far camera is from origin
	rotation - about x & y axes, by left-hand screw rule, relative to camera looking along +z
	zoom - the relative length of the lens
*/
void camPolar( out vec3 pos, out vec3 dir, in vec3 origin, in vec2 rotation, in float dist, in float zoom )
{
	// get rotation coefficients
	vec2 c = cos(rotation);
	vec4 s;
	s.xy = sin(rotation);
	s.zw = -s.xy;

	// ray in view space
	dir.xy = gl_FragCoord.xy - iResolution.xy*.5;
	dir.z = iResolution.y*zoom;
	dir = normalize(dir);
	
	// rotate ray
	dir.yz = dir.yz*c.x + dir.zy*s.zx;
	dir.xz = dir.xz*c.y + dir.zx*s.yw;
	
	// position camera
	pos = origin - dist*vec3(c.x*s.y,s.z,c.x*c.y);
}

//==TEXTURING FUNCTIONS=============================================================
/*
	Takes a 3D coordinate, and returns a texel based on which plane(s)
	it lies in.
	
*/
vec3 tex3D( in vec3 pos, in vec3 normal, sampler2D sampler )
{
	return 	texture2D( sampler, pos.yz )*abs(normal.x).rgb+ 
			texture2D( sampler, pos.zx )*abs(normal.y).rgb+ 
			texture2D( sampler, pos.xy )*abs(normal.z).rgb;
}

//==ASSORTED MATH STUFFS============================================================
/*
	Returns a smoothed minimum between two values. (By Inigo Quilez)
*/
float smin( float a, float b, float k )
{ 
	float res = exp( -k*a ) + exp( -k*b );
    return -log( res )/k;
}

//==DISTANCE FUNCTIONS==============================================================
// aka the Inigo Quilez section
/*
	Returns the distance to the surface of a plane with the given height and normal.
	This is signed as well; if you are below the plane you will get negative values.
*/
float distPlaneBump(vec3 samplePos, vec3 planeNormal, float planeHeight, sampler2D image, float scale)
{
	float bump = 0.0;
	float dist = dot(samplePos, normalize(planeNormal)) + planeHeight;
	if(dist < GROUND_BUMP_FACTOR*2.0)
		bump = texture2D(image, samplePos.xz*scale).r*GROUND_BUMP_FACTOR;
	return (dist-GROUND_BUMP_FACTOR)+bump;
}

/*
	Returns the distance to a repeated cylinder, with no image based surface displacement.
*/
float distCylinder( vec3 pos, vec3 properties )
{
	pos.xz += sin(pos.zx)*.25;
	pos.xz = mod(pos.xz,TREE_REP.xz);
	pos.xz -= vec2(TREE_REP.xz*.5);
	
	return length(pos.xz-properties.xy)-properties.z;
}

/*
	Returns the distance to a repeated cylinder, with image based surface displacement.
*/
float distCylinderBump( vec3 pos, vec3 properties, sampler2D image, float scale)
{
	// Add in a bit of positional variation.
	pos.xz += sin(pos.zx)*.25;
	
	// Mod the position along the XZ plane for repetition.
	pos.xz = mod(pos.xz,TREE_REP.xz);
	
	// Bring the location back to the center of the modded domain.
	pos.xz -= vec2(TREE_REP.xz*.5);
	
	// Create a variable to store potential bump.
	float bump = 0.0;
	
	// Find the distance from the point to the object
	// accounting for minimum bump height.
	float dist = length(pos.xz-properties.xy)-properties.z;
	
	// If it's less than the maximum bump height we need to figure
	// out the specific distance to the object including proper bump.
	if(dist < FEATURE_BUMP_FACTOR*2.0)
	{
		// Get a general okay flat-surface normal.
		vec2 normal = normalize(pos.xz-properties.xy);
		
		// Get the bumpheight by sampling the red channel of a texture.
		bump = tex3D(pos*scale+pos, vec3(normal.x, 0.0, normal.y), image).r*FEATURE_BUMP_FACTOR;
	}
	return dist-bump;
}

/*
	Returns the distance to a repeated capsule shape.
*/
float distCapsule(vec3 pos, vec3 a, vec3 b, float r, sampler2D image, float scale)
{
	pos.xz += sin(pos.zx)*.25;
	pos.xz = mod(pos.xz,TREE_REP.xz);
	pos.xz -= vec2(TREE_REP.xz*.5);
	
    vec3 pa = (pos) - a;
	vec3 ba = b - a;
    float h = clamp( dot(pa, ba)/dot(ba, ba), 0.0, 1.0 );
	
	float bump = 0.0;
	float dist = length( pa - ba*h ) - r;
	if(dist < FEATURE_BUMP_FACTOR)
	{
		vec2 normal = normalize(pos.xy);
		vec3(normal.x, 0.0, normal.y);
		bump = tex3D(pos*scale, vec3(normal.x, 0.0, normal.y), image).r*FEATURE_BUMP_FACTOR*.5;
	}
	return dist + bump;
}

/*
	Returns the distance to the nearest snow feature, whether it's the ground, the
	tree collection, or the windswept bits.
*/
float distSnow(vec3 pos)
{
	return min(smin(distPlaneBump(pos, GROUND_NORMAL, GROUND_HEIGHT, SNOW_BUMP, SNOW_TEX_SCALE), 
					   distCapsule(pos, SNOW_BOTTOM, SNOW_TOP, SNOW_RAD, SNOW_BUMP, SNOW_TEX_SCALE), SMIN_FACTOR), 
			distCylinderBump(pos, TREE_SNOW_PROP, TREE_SNOW_BUMP, SNOW_TEX_SCALE));
}

/*
	Returns the distance to the nearest tree.
*/
float distTree(vec3 pos)
{
	return distCylinderBump(pos, TREE_PROP, TREE_BUMP, TREE_TEX_SCALE);
}

/*
	Returns the base normal of a repeated cylinder.
*/
vec3 getCylinderNormal(vec3 pos, vec3 properties)
{
	// Perform modulation to keep in line with our cylinder distance function.
	pos.xz = mod(pos.xz,TREE_REP.xz);
	pos.xz -= vec2(TREE_REP.xz*.5);
	
	// Since we can assume that the cylinder is vertical,
	// the only coordinates that matter are x and z.
	// This speeds up normal generation quite a bit.
	vec2 normal = normalize(pos.xz-properties.xy);
	return vec3(normal.x, 0.0, normal.y);
}

/*
	Returns the distance to the nearest point in the scene.
*/
float getDist(vec3 samplePos)
{
		
	return min(distTree(samplePos),
			   distSnow(samplePos));
}

/*
	Returns the color of the nearest object in the scene.
*/
vec3 getColor(vec3 samplePos)
{
	// If we are closer to snow, return the color of the snow.
	if(distSnow(samplePos) < distTree(samplePos))
	{
		return vec3(1.0);
	}
	// Otherwise return our "wood" texture.
	else return tex3D(samplePos*4.0, getCylinderNormal(samplePos, TREE_PROP), iChannel0)*vec4(.75, .75, .85);
}

//==RAY MARCHING FUNCTIONS=========================================================
/*
		Marches the 3D point <pos> along the given direction.
	When the point is either stepped the maximum number of times,
	has passed the maximum distance, or is within a set distance
	from geometry the function returns. 
		Note that the position is passed by reference and is modified
	for use within the function.
*/
void marchThroughField(inout vec3 pos, vec3 dir)
{
	float dist;
	
	for(int i = 0; i < MAX_VIEW_STEPS; i++)
	{
		dist = getDist(pos);
		if(dist < EPSILON || dist > MAX_DEPTH)
			return;
		else	
			pos += dir*dist*.75;
	}
	return;
}

//==LIGHTING FUNCTIONS==============================================================
/*
	Returns the surface normal of a point in the distance function.
*/
vec3 getNormal(vec3 pos)
{
	float d=getDist(pos);
	// Create the normal vector by comparing the distance near our point.
	return normalize(vec3( getDist(pos+vec3(EPSILON,0,0))-d, getDist(pos+vec3(0,EPSILON,0))-d, getDist(pos+vec3(0,0,EPSILON))-d ));
}

/*
	Returns the amount of fog in a scene at the given distance.
*/
vec4 addFog(float dist, vec3 before, vec3 fogColor)
{
	return mix(before, fogColor, pow((dist/MAX_DEPTH),2.0));
}

/*
	Calculates the ambient occlusion factor at a given point in space.
	Written from Inigo Quilez' algorithm.
*/
float calcOcclusion(vec3 pos, vec3 norm)
{
  float result = 1.0;
  float s = -OCC_SAMPLES;
  const float unit = 1.0/OCC_SAMPLES;
  for(float i = unit; i < 1.0; i+=unit)
  {
    result -= pow(2.0,i*s)*(i-getDist(pos+i*norm));
  }
  return result*OCC_FACTOR;
}

/*
	Calculates how much light remains if shadows are considered.
	Generally IQ's soft shadow algorithm.
*/
float calcShadow( vec3 origin, vec3 lightDir, SpotLight light)
{	
	float dist;
	float result = 1.0;
	float lightDist = length(light.position-origin);
	
	vec3 pos = vec3(origin)+(lightDir*(EPSILON+FEATURE_BUMP_FACTOR));
	
	for(int i = 0; i < MAX_SHADOW_STEPS; i++)
	{
		dist = getDist(pos);
		if(dist < EPSILON)
		{
			return 0.0;
		}
		if(length(pos-origin) > lightDist || length(pos-origin) > MAX_DEPTH)
		{
			return result;
		}
		pos+=lightDir*dist;
		if( length(pos-origin) < lightDist )
		{
			result = min( result, lightDist*light.penumbraFactor*dist / length(pos-origin) );
		}
	}
	return result;
}

/*
	Returns the product of the Phong lighting equation on a point in space given
	a (SPOT) light and the surface's material.
*/
vec3 calcLighting(vec3 samplePos, vec3 eye, SpotLight light, Material material)
{
	float lightDist = length(light.position-samplePos);
	vec3 lightDir = normalize(light.position-samplePos);
	vec3 eyeDir = normalize(samplePos-eye);
	vec3 surfaceNormal = getNormal(samplePos);
	vec3 reflection = normalize(reflect(eyeDir, surfaceNormal));
	
	float specular, diffuse, ambient = AMBIENT_LIGHT;
	float attenuation, shadow, occlusion;
	
	float spotCos = dot(-lightDir, light.direction);
	float spotCoefficient = smoothstep( 1.0-light.spread, 1.0, spotCos );
	
	// If it's outside of the light's cone we don't need to calculate any terms.
	if(spotCos < 1.0-light.spread)
	{
		specular = 0.0;
		diffuse = 0.0;
		attenuation = 0.0;
		shadow = 0.0;
	}
	else
	{
		specular = pow(max( 0.0, dot(lightDir, reflection)*spotCoefficient), 80.4);
		diffuse = max( 0.0, dot(lightDir, surfaceNormal)*spotCoefficient);
		attenuation = min(1.0, (1.0/(lightDist/light.brightness)));
		shadow = calcShadow(samplePos, lightDir, light);
	}
	occlusion = calcOcclusion(samplePos, surfaceNormal);
	vec3 objectColor = getColor(samplePos);
	return light.color*objectColor*clamp(((specular+diffuse)*shadow*attenuation), 0.0, 1.0)+(ambient*occlusion*AMBIENT_COLOR*objectColor);
}

/*
	Shade a point after it has been marched and found.
*/
vec3 shade(vec3 pos, vec3 eye, SpotLight light, Material material)
{
	vec3 fog = textureCube(iChannel3, normalize(eye-pos)).rgb*AMBIENT_COLOR;
	float dist = length(eye-pos);
	if(dist > MAX_DEPTH)
	{
		return fog;
	}
	else
	{
		vec3 litTexel = calcLighting(pos, eye, light, material);
		return addFog(dist, litTexel, fog);
	}
}
									
void main(void)
{
	vec3 pos, dir, eye;
	
	vec2 facing = (iMouse.yx/iResolution.yx)-vec2(.5);
	vec3 camPos = vec3(0.0, .025*abs(sin(iGlobalTime*5.0)), iGlobalTime-.5);
	vec3 lightPos = vec3(0.0, .025*abs(sin(iGlobalTime*5.0))-.01, iGlobalTime);
	vec3 lightDir = normalize(vec3(sin(facing.y), sin(facing.x)*2.0, cos(facing.y)));
	facing.x = -facing.x;
	
	SpotLight light = SpotLight(lightPos,
						lightDir, 
						LIGHT_COLOR, 
						LIGHT_BRIGHT, LIGHT_SPREAD, PEN_FACTOR);
	
	Material mat = Material(vec3(1.0), 1.0);					   
	
	camPolar(pos, dir, camPos, facing, .05, 1.0);
	eye = vec3(pos);
	
	marchThroughField(pos, dir);
	
	gl_FragColor = shade(pos, eye, light, mat);
}