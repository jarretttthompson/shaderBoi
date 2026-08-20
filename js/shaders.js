// Built-in shader library. Users add more via the UI (persisted to localStorage).

const BUILTIN_SHADERS = [
{
  id: 'builtin-haunted-forest',
  name: 'Haunted Forest',
  builtin: true,
  code: `// Haunted forest shader
//
// Created by Frank Hugenroth /frankenburgh/ 04/2013

#define V2 1

// random/hash function
float hash( float n )
{
  return fract(cos(n)*41415.92653);
}

// 2d noise function
float noise( in vec2 x )
{
  vec2 p  = floor(x);
  vec2 f  = smoothstep(0.0, 1.0, fract(x));
  float n = p.x + p.y*57.0;

  return mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
    mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y);
}

// 3d noise function
float noise( in vec3 x )
{
  vec3 p  = floor(x);
  vec3 f  = smoothstep(0.0, 1.0, fract(x));
  float n = p.x + p.y*57.0 + 113.0*p.z;

  return mix(mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
    mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y),
    mix(mix( hash(n+113.0), hash(n+114.0),f.x),
    mix( hash(n+170.0), hash(n+171.0),f.x),f.y),f.z);
}


mat3 m = mat3( 0.00,  1.60,  1.20, -1.60,  0.72, -0.96, -1.20, -0.96,  1.28 );

// Fractional Brownian motion
float fbm( vec3 p )
{
  float f = 0.5000*noise( p ); p = m*p*1.2;
  f += 0.2500*noise( p ); p = m*p*1.3;
  f += 0.1666*noise( p ); p = m*p*1.4;
  f += 0.0834*noise( p );
  return f;
}




float branch(in float ang, in vec2 uv, in float len, in float th, in float sharpness )
{
	float x = sin(ang*2.*3.14159);
	float y = cos(ang*2.*3.14159);

	float ans2 = y*uv.x-x*uv.y;
	bool hit2 = ans2>=0. && ans2< len;
	if (!hit2)
		return 1.0;

	float ans = x*uv.x+y*uv.y;

	float t = pow(1.-ans2/len, .25)*th + (1.0-ans2/len)*.01;
#ifdef V2
	ans += texture(iChannel0, vec2(ans2/len*.008+.74, th+.3)).r * 0.13;
	ans += texture(iChannel0, vec2(ans2/len*.01+.91, th+.3)).r * 0.06;
	ans += texture(iChannel0, vec2(ans2/len*.03+.5 , th+.4)).g * 0.06;
	ans += texture(iChannel0, vec2(ans2/len*.03+.51, th+.4)).g * 0.03;
#else
	ans += texture(iChannel0, vec2(ans2/len*.02+.74, th+.3)).r * 0.17;
	ans += texture(iChannel0, vec2(ans2/len*.02+.91, th+.3)).r * 0.09;
	ans += texture(iChannel0, vec2(ans2/len*.07+.5 , th+.4)).g * 0.09;
	ans += texture(iChannel0, vec2(ans2/len*.07+.51, th+.4)).g * 0.05;
#endif
	float val = clamp(pow(abs(ans) / abs(t), 1.), 0.0, 1.0);

	val = pow(val, sharpness);
	return val;
}


float trunk(in float ang, in vec2 uv, in float len, in float strength, in float sharpness )
{
	float x = sin(ang*2.*3.14159);
	float y = cos(ang*2.*3.14159);

	float ans2 = y*uv.x-x*uv.y;
	bool hit2 = ans2>=0. && ans2< len;
	if (!hit2)
		return 1.0;

	float ans = x*uv.x+y*uv.y;

	float t = pow(1.-ans2/len, .25)*strength + (1.0-ans2/len)*texture(iChannel0, vec2(ans2/len*.3, len*.8)).r*.025;
#ifdef V2
	ans += texture(iChannel0, vec2(ans2/len*.1, strength)).r * 0.04;
#else
	ans += texture(iChannel0, vec2(ans2/len*.2, strength)).r * 0.08;
#endif

	float val = clamp(pow(abs(ans) / abs(t), 1.), 0.0, 1.0);

	val = pow(val, sharpness);
	return val;
}


float fir(in float ang, in vec2 uv, in float len, in float strength, in float sharpness )
{
	float x = sin(ang*2.*3.14159);
	float y = cos(ang*2.*3.14159);

	float ans2 = y*uv.x-x*uv.y;
	bool hit2 = ans2>=0. && ans2< len;
	if (!hit2)
		return 1.0;

	float ans = x*uv.x+y*uv.y;

	float t = pow(1.-ans2/len, .25)*strength + (1.0-ans2/len)*texture(iChannel0, vec2(ans2/len*.3, len*.8)).r*.15;
	ans += texture(iChannel0, vec2(ans2/len*.2, strength)).r * 0.04;

	float val = clamp(pow(abs(ans) / abs(t), 1.), 0.0, 1.0);

	val = pow(val, sharpness);
	return val;
}


float tree2(in float ang, in vec2 uv, in float len, in float th, in float sharpness)
{
	float val = 1.;
	// mid
	float x = sin(ang*2.*3.14159);
	float y = cos(ang*2.*3.14159);
	vec2 uvl = uv + vec2(-y*len*0.42 +x*len*+0.01 , x*len*0.42 +y*len*+0.01 );
	vec2 uvr = uv + vec2(-y*len*0.37 +x*len*-0.01 , x*len*0.37 +y*len*-0.01 );
	val *= branch(ang, uv, len, th, sharpness) * branch(ang-.095, uvl, len*.7, th*.3, sharpness) * branch(ang+.075, uvr, len*0.8, th*.2, sharpness);
	return val;
}


float tree1(in float ang, in vec2 uv, in float len, in float th, in float sharpness)
{
	float val = 1.;
	// mid
	float x = sin(ang*2.*3.14159);
	float y = cos(ang*2.*3.14159);
#ifdef V2
	vec2 uvl = uv + vec2(-y*len*0.60 -x*len*0.09 , x*len*0.60 -y*len*0.09 );
	vec2 uvr = uv + vec2(-y*len*0.59 -x*len*0.12 , x*len*0.59 -y*len*0.12 );
	val *= trunk(ang, uv, len, .024, sharpness) * branch(ang-.13, uvl, len*.7, .008, sharpness) * branch(ang+.125, uvr, len*1.2, .005, sharpness);
	// left
	float ang1 = ang-.1; float len1 = len*.7; vec2 uv1 = uvl;
	x = sin(ang1*2.*3.14159);y = cos(ang1*2.*3.14159);
	vec2 uvl1 = uv1 + vec2(-y*len1*0.01+x*len*-0.022, x*len1*0.01+y*len*-0.022);
	vec2 uvr1 = uv1 + vec2(-y*len1*0.5 +x*len* 0.01 , x*len1*0.5 +y*len* 0.01);
	val *= branch(ang1-.1, uvl1, len1*.7, .003, sharpness) * branch(ang1+.13, uvr1, len1*.6, 0.005, sharpness);
	// right
	float ang2 = ang+.13; float len2 = len*.6; vec2 uv2 = uvr;
	x = sin(ang2*2.*3.14159);y = cos(ang2*2.*3.14159);
	vec2 uvl2 = uv2 + vec2(-y*len2*0.6 +x*len*-0.04, x*len2*0.6 +y*len*-0.04);
	vec2 uvr2 = uv2 + vec2(-y*len2*0.5 +x*len*+0.045, x*len2*0.5 +y*len*+0.045);
	val *= branch(ang2-.072, uvl2, len2*.8, 0.001, sharpness) * branch(ang2+.13, uvr2, len2*.6, 0.003, sharpness);
#else
	vec2 uvl = uv + vec2(-y*len*0.60 -x*len*0.11 , x*len*0.60 -y*len*0.11 );
	vec2 uvr = uv + vec2(-y*len*0.59 -x*len*0.15 , x*len*0.59 -y*len*0.15 );
	val *= trunk(ang, uv, len, .024, sharpness) * branch(ang-.13, uvl, len*.7, .008, sharpness) * branch(ang+.125, uvr, len*1.2, .005, sharpness);
	// left
	float ang1 = ang-.1; float len1 = len*.7; vec2 uv1 = uvl;
	x = sin(ang1*2.*3.14159);y = cos(ang1*2.*3.14159);
	vec2 uvl1 = uv1 + vec2(-y*len1*0.01+x*len*+0.00, x*len1*0.01+y*len*+0.00);
	vec2 uvr1 = uv1 + vec2(-y*len1*0.4 +x*len* 0.02 , x*len1*0.4 +y*len* 0.02);
	val *= branch(ang1-.1, uvl1, len1*.7, .003, sharpness) * branch(ang1+.13, uvr1, len1*.6, 0.005, sharpness);
	// right
	float ang2 = ang+.13; float len2 = len*.6; vec2 uv2 = uvr;
	x = sin(ang2*2.*3.14159);y = cos(ang2*2.*3.14159);
	vec2 uvl2 = uv2 + vec2(-y*len2*0.6 +x*len*-0.08, x*len2*0.6 +y*len*-0.08);
	vec2 uvr2 = uv2 + vec2(-y*len2*0.5 +x*len*-0.022, x*len2*0.5 +y*len*-0.022);
	val *= branch(ang2-.032, uvl2, len2*.8, 0.001, sharpness) * branch(ang2+.13, uvr2, len2*.6, 0.003, sharpness);
#endif
	return val;
}





void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	float time = iTime * 0.1;

	vec2 uv = fragCoord.xy / iResolution.y;
	uv -= vec2(.25, 0.);

	float val1 = 1.;
	float val2 = 1.;
	float val3 = 1.;
	float val4 = 1.;

	// trees
	val2 *= tree1(0.79+sin(time*5.+.0 )*0.006, uv                ,  .75, 0.024, 9.);
	val2 *= tree1(0.73+sin(time*5.+.1 )*0.006, uv+vec2(-1.15, 0.),  .99, 0.024, 9.);
	val3 *= tree2(0.73+sin(time*5.-.3 )*0.006, uv+vec2(-0.85, 0.), 1.00, 0.014, 8.);
	val3 *= tree2(0.78+sin(time*5.+.2 )*0.006, uv+vec2(0.182, 0.), 1.00, 0.014, 8.);
#if 1
	// trunks front
	val1 *= trunk(0.79+sin(time*5.+.4 )*0.008, uv+vec2(.2  , 0.), 1.2, .054, 4.);
	val1 *= trunk(0.77+sin(time*5.+.47)*0.004, uv+vec2(.27 , 0.), 1.2, .024, 8.);
	val1 *= trunk(0.72+sin(time*5.+.6 )*0.003, uv+vec2(-1.5, 0.), 2.2, .094, 3.);
	val1 *= trunk(0.72+sin(time*5.+.8 )*0.006, uv+vec2(-1.3, 0.), 2.2, .034, 10.);
	// trunks far
	val2 *= trunk(0.78+sin(time*5.-.64)*0.008, uv+vec2(.03 , 0.), 0.9, .013, 9.);
	val2 *= trunk(0.76+sin(time*5.-.27)*0.007, uv+vec2(.15 , 0.), 1.1, .030, 9.);
	val3 *= trunk(0.78+sin(time*5.-.37)*0.007, uv+vec2(-.15, 0.), 0.8, .010, 8.);
	val3 *= trunk(0.72+sin(time*5.+.37)*0.007, uv+vec2(-1.04,0.), 0.7, .013, 4.);
#endif
#if 1
	// far firs#1
    float bb = 0.;
	for (int b=0; b<7; b++)
	{
    	float rand = hash(bb*10.);
	    val3 *= fir(0.77+sin(time*5.+.37+rand)*0.007-bb*.010, uv+vec2(-.18-bb*.14-rand*.13 ,0.), 0.28+rand*.3,.011+rand*.003, 3.);	bb += 1.;
	}
	// very far firs#2
	bb = 0.;
	for (int b=0; b<7; b++)
	{
    	float rand = hash(bb*10.);
	    val3 *= fir(0.77+sin(time*5.-.37+rand*1.41)*0.004-bb*.009, uv+vec2(-.20-bb*.10-rand*.08 ,0.), 0.22+rand*.3,.007+rand*.003, 1.);	bb += 1.;
	}
#endif

	vec3 col  = vec3(0., 0., 0.);
	vec3 tcol = vec3(0., 0., 0.);

	vec2 xy = -1.0 + 2.0*fragCoord.xy / iResolution.xy;
	vec2 s = xy*vec2(1.75,1.2);

	// get camera position and view direction
	vec3 campos = vec3(0.0, 0.0, 0.0);
	vec3 camtar = vec3(0.0, 0.35, 1.0);

	vec3 light       = normalize( vec3(  0.1, 0.55,  0.9 ) );

	float roll = 0.0;
	vec3 cw = normalize(camtar-campos);
	vec3 cp = vec3(sin(roll), cos(roll),0.0);
	vec3 cu = normalize(cross(cw,cp));
	vec3 cv = normalize(cross(cu,cw));
	vec3 rd = normalize( s.x*cu + s.y*cv + 1.6*cw );
	float sundot = clamp(dot(rd,light),0.0,1.0);

	if (val2<.99)
		tcol = 0.8*vec3(1.0,1.0,1.0)*pow( sundot, 300.0 );

	// render sky
    float t = pow(1.0-0.7*rd.y, 1.0);
    col += vec3(.1, .2, .4)*(1.0-t);
    // moon
    col += 0.30*min(vec3(2.0, 2.0, 2.0), vec3(2.0,2.0,2.0)*pow( sundot, 350.0 ));
    // moon haze
    col += 0.6*vec3(0.8,0.9,1.0)*pow( sundot, 6.0 );
    // stars
	vec3 stars = vec3(0.,0.,0.);
	if (t<1.0)
	{
		vec3 scol = clamp(vec3(1.2, 1.0, 0.8) * pow(noise(uv*120.), 120.) * 50. * (.5-pow(t,20.)), 0.0, 1.0);
		scol += clamp(vec3(1.2, 1.0, 0.8) * pow(noise(uv*160.), 300.) * 40. * (.5-pow(t,20.)), 0.0, 1.0);

		float st = 100.;
		float grow = .0;
		for (int i=0; i<12; i++)
		{
        	float sundot2 = clamp(dot(rd,normalize( vec3( 2.*noise(vec2(st, 0.))-1., noise(vec2(st, 1876.))+.3,  0.9 ) )),0.0,1.0);
	    	scol += 0.200*vec3(6.0,5.0,2.0)*pow( sundot2, 190000.0-grow );
			st += 11.;
			grow += 9000.;
		}
		stars = scol * (.3+.7*fbm(vec3(time*80., 10.0*uv.x+55.0*uv.y, 0.)));
	}

	// Clouds
    vec2 shift = vec2( time*200.0, time*280.0 );
    vec4 sum = vec4(0,0,0,0);
#if 1
	for (int q=1000; q<1060; q++) // 120 layers
    {
      if (sum.w>0.999) break;
      float c = (float(q-1000)*10.0+350.0-campos.y) / rd.y; // cloud height
      vec3 cpos = campos + c*rd + vec3(831.0+shift.x, 321.0+float(q-1000)*.15-shift.x*0.2, 1330.0+shift.y); // cloud position
      float alpha = smoothstep(0.5, 1.0, fbm( cpos*0.0015 ))*.9; // fractal cloud density
      vec3 localcolor = mix(vec3( 1.1, 1.05, 1.0 ), 0.7*vec3( 0.4,0.4,0.3 ), alpha); // density color white->gray
      alpha = (1.0-sum.w)*alpha; // alpha/density saturation (the more a cloud layer's density, the more the higher layers will be hidden)
      sum += vec4(localcolor*alpha, alpha); // sum up weightened color
    }
#endif
	float alpha = smoothstep(0.7, 1.0, sum.w);
    sum.rgb /= sum.w+0.0001;
    sum.rgb -= 0.6*vec3(0.8, 0.75, 0.7) * pow(sundot,10.0)*alpha;
    sum.rgb += 0.2*vec3(1.2, 1.2, 1.2) * pow(sundot,5.0)*(1.0-alpha);

	if (t<1.)
    	col = mix( col, sum.rgb , 1.0*sum.w*pow(sundot,3.0)*(1.0-pow(t,10.)) );


	// stars
	col += 1.0*stars*(1.-sum.w*sum.w);

	// trees #3
    col = col*val3 + (1.-t*.8)*vec3(0.3, 0.4, 0.5)*(1.0-val3);
	// trees #2
    col = col*val2 + (1.-t*.8)*vec3(0.1, 0.2, 0.3)*(1.0-val2);

	// moving fog
    float c = 650.0 / (rd.x-1.1);
    vec3 cpos = campos + c*rd + vec3(831.0-time*1000., 321.0, 0.0);
    col += fbm( cpos*0.0015 )*.3 - .10;

	// trees #1
	col *= val1; // trees
	// tree-moon glow
	col += 1.2*tcol*(1.-sum.w*sum.w);

	fragColor = vec4(col,1.0);
}`
},
{
  id: 'builtin-ember-drift',
  name: 'Ember Drift',
  builtin: true,
  code: `// Ember Drift — simple demo shader shipped with ShaderDeck
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0));
  float c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

float fbm2(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a*vnoise(p); p = p*2.03 + 17.0; a *= 0.5; }
  return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = uv * vec2(iResolution.x/iResolution.y, 1.0);
  float t = iTime * 0.12;

  float n = fbm2(p*3.0 + vec2(t*0.7, -t*1.6));
  float n2 = fbm2(p*7.0 + vec2(-t*1.3, -t*2.8) + n*2.0);

  vec3 deep  = vec3(0.03, 0.02, 0.05);
  vec3 smoke = vec3(0.16, 0.10, 0.12);
  vec3 ember = vec3(0.95, 0.45, 0.12);
  vec3 hot   = vec3(1.0, 0.85, 0.5);

  float glow = pow(1.0 - uv.y, 2.4);
  vec3 col = mix(deep, smoke, n);
  col = mix(col, ember, glow * smoothstep(0.45, 0.95, n2));
  col = mix(col, hot, glow * smoothstep(0.75, 0.98, n2) * 0.8);

  // drifting sparks
  vec2 sp = vec2(uv.x*40.0, uv.y*30.0 - iTime*2.0);
  float spark = step(0.996, hash21(floor(sp))) * fract(sin(iTime + hash21(floor(sp))*31.0)*4.0);
  col += hot * spark * (1.0 - uv.y);

  col *= 0.85 + 0.15*vnoise(p*200.0 + iTime);   // grain
  fragColor = vec4(col, 1.0);
}`
},
{
  id: 'builtin-prairie-dusk',
  name: 'Prairie Dusk',
  builtin: true,
  code: `// Prairie Dusk — slow sunset over rolling plains
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x),
             mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a*vnoise(p); p = p*2.02 + 11.3; a *= 0.5; }
  return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / iResolution.xy;
  float asp = iResolution.x / iResolution.y;
  float t = iTime * 0.02;

  // layered sunset sky
  vec3 zen = vec3(0.09, 0.07, 0.20);
  vec3 mid = vec3(0.52, 0.20, 0.24);
  vec3 hor = vec3(1.00, 0.55, 0.18);
  vec3 col = mix(hor, mid, smoothstep(0.16, 0.52, uv.y));
  col = mix(col, zen, smoothstep(0.45, 0.95, uv.y));

  // low sun with haze
  vec2 sun = vec2(0.62*asp, 0.30);
  float d = distance(vec2(uv.x*asp, uv.y), sun);
  col += vec3(1.0, 0.75, 0.40) * 0.55 * exp(-d*d*40.0);
  col += vec3(1.0, 0.60, 0.30) * 0.25 * exp(-d*4.0);

  // slow cloud streaks catching the light
  float cl = fbm(vec2(uv.x*4.0 + t*3.0, uv.y*14.0));
  float band = smoothstep(0.35, 0.75, uv.y) * smoothstep(0.95, 0.60, uv.y);
  col = mix(col, vec3(0.95, 0.50, 0.35), cl*band*0.28);

  // first stars up top
  float sr = h21(floor(fragCoord/2.0));
  float st = pow(sr, 90.0) * smoothstep(0.55, 0.95, uv.y);
  st *= 0.5 + 0.5*sin(iTime*2.0 + sr*40.0);
  col += vec3(st);

  // three ridgelines drifting at parallax speeds
  float r1 = 0.30 + fbm(vec2(uv.x*2.0 + t*0.5, 1.0))*0.05;
  col = mix(col, vec3(0.30, 0.13, 0.17), smoothstep(r1+0.003, r1-0.003, uv.y));
  float r2 = 0.22 + fbm(vec2(uv.x*3.0 + 7.0 + t*0.9, 2.0))*0.06;
  col = mix(col, vec3(0.11, 0.05, 0.09), smoothstep(r2+0.003, r2-0.003, uv.y));
  float r3 = 0.14 + fbm(vec2(uv.x*4.0 + 17.0 + t*1.4, 3.0))*0.06;
  col = mix(col, vec3(0.02, 0.015, 0.03), smoothstep(r3+0.003, r3-0.003, uv.y));

  // grain + gentle vignette
  col *= 0.92 + 0.08*vnoise(fragCoord*0.8 + iTime);
  vec2 c = uv - 0.5;
  col *= 1.0 - 0.35*dot(c, c);

  fragColor = vec4(col, 1.0);
}`
},
{
  id: 'builtin-neon-saloon',
  name: 'Neon Saloon',
  builtin: true,
  code: `// Neon Saloon — warm drifting bar-light bokeh with flicker
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

vec3 bokeh(vec2 uv, float scale, float drift, float blur, vec3 tintA, vec3 tintB){
  vec2 p = uv*scale + vec2(iTime*0.05*drift, sin(iTime*0.02)*0.2);
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 cid = id + o;
    float rnd = h21(cid);
    vec2 cpos = o + vec2(h21(cid+3.1), h21(cid+7.7)) - 0.5 - f;
    float r = 0.10 + rnd*0.22;
    float disc = smoothstep(r, r - blur*r, length(cpos));
    disc *= 0.55 + 0.45*sin(iTime*(0.4+rnd) + rnd*30.0);   // lazy flicker
    acc += mix(tintA, tintB, h21(cid+13.7)) * disc * (0.35 + 0.65*rnd);
  }
  return acc;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*iResolution.xy) / iResolution.y;

  vec3 col = mix(vec3(0.05, 0.02, 0.01), vec3(0.09, 0.03, 0.02), uv.y + 0.5);
  vec3 amber = vec3(1.00, 0.55, 0.15);
  vec3 red   = vec3(0.90, 0.15, 0.10);
  vec3 gold  = vec3(1.00, 0.80, 0.40);

  col += bokeh(uv,          3.0, 0.8, 0.90, amber, red ) * 0.28;  // far, soft
  col += bokeh(uv + 7.3,    2.0, 1.3, 0.60, amber, gold) * 0.34;  // mid
  col += bokeh(uv + 3.7,    1.2, 2.0, 0.22, amber, red ) * 0.40;  // near, crisp
  col += vec3(0.25, 0.10, 0.04) * exp(-length(uv)*1.2) * 0.5;     // room haze

  col *= 1.0 - 0.5*dot(uv, uv);
  fragColor = vec4(col, 1.0);
}`
},
{
  id: 'builtin-whiskey-swirl',
  name: 'Whiskey Swirl',
  builtin: true,
  code: `// Whiskey Swirl — slow amber marbling, like light through a glass
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x),
             mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; }
  return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*iResolution.xy) / iResolution.y;
  float t = iTime * 0.06;

  float ang = t*0.30;
  mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 p = R * uv * 1.8;

  // double domain warp
  vec2 q = vec2(fbm(p + vec2(0.0, t)),
                fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0*q + vec2(1.7, 9.2) + t*0.6),
                fbm(p + 3.0*q + vec2(8.3, 2.8) - t*0.4));
  float f = fbm(p + 3.0*r);

  vec3 deep  = vec3(0.10, 0.03, 0.01);
  vec3 amber = vec3(0.72, 0.33, 0.08);
  vec3 gold  = vec3(1.00, 0.72, 0.28);
  vec3 cream = vec3(1.00, 0.90, 0.60);

  vec3 col = mix(deep, amber, clamp(f*f*3.0, 0.0, 1.0));
  col = mix(col, gold, clamp(length(q)*0.8, 0.0, 1.0) * 0.55);
  col = mix(col, cream, clamp(r.x*r.y*1.5, 0.0, 1.0) * 0.30);

  col *= 0.90 + 0.20*fbm(uv*40.0 + t);   // grain
  col *= 1.0 - 0.45*dot(uv, uv);         // vignette
  fragColor = vec4(col, 1.0);
}`
},
{
  id: 'builtin-starry-plains',
  name: 'Starry Plains',
  builtin: true,
  code: `// Starry Plains — big night sky, milky way, the odd shooting star
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x),
             mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a*vnoise(p); p = p*2.02 + 7.7; a *= 0.5; }
  return v;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = fragCoord / iResolution.xy;
  float asp = iResolution.x / iResolution.y;
  float t = iTime * 0.01;

  // deep night gradient
  vec3 col = mix(vec3(0.010, 0.015, 0.045), vec3(0.000, 0.002, 0.012), uv.y);
  col = mix(vec3(0.030, 0.030, 0.060), col, smoothstep(0.10, 0.35, uv.y)); // horizon glow

  // two scales of twinkling stars
  float s1 = h21(floor(fragCoord/2.0));
  float star = pow(s1, 110.0) * (0.4 + 0.6*sin(iTime*1.5 + s1*50.0));
  float s2 = h21(floor(fragCoord/3.0) + 31.7);
  star += pow(s2, 160.0) * 1.5 * (0.5 + 0.5*sin(iTime*0.8 + s2*80.0));
  col += vec3(1.0, 0.95, 0.85) * star * smoothstep(0.12, 0.30, uv.y);

  // milky way band, slightly diagonal, drifting very slowly
  float bandPos = uv.y - (0.62 + 0.18*(uv.x - 0.5) + t);
  float band = exp(-bandPos*bandPos*30.0);
  float wisp = fbm(vec2(uv.x*6.0 + t*8.0, uv.y*9.0));
  col += vec3(0.42, 0.45, 0.60) * band * wisp * 0.55;
  col += vec3(0.20, 0.18, 0.30) * band * 0.25;

  // occasional shooting star (roughly one pass every 7s, 40% of cycles fire)
  float cycle = floor(iTime/7.0);
  float ct = fract(iTime/7.0);
  if (h21(vec2(cycle, 3.3)) > 0.6){
    vec2 P = vec2(uv.x*asp, uv.y);
    vec2 s0 = vec2(h21(vec2(cycle, 1.0))*asp, 0.75 + 0.20*h21(vec2(cycle, 2.0)));
    vec2 dir = normalize(vec2(0.75, -0.30));
    vec2 sp = s0 + dir*ct*1.4;
    vec2 pa = P - (sp - dir*0.10);
    vec2 ba = dir*0.10;
    float hseg = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
    float dseg = length(pa - ba*hseg);
    float win = sin(clamp(ct*3.0, 0.0, 1.0)*3.14159);
    col += vec3(1.0, 0.95, 0.8) * exp(-dseg*260.0) * win * (0.3 + 0.7*hseg);
  }

  // grass silhouette
  float g = 0.13 + fbm(vec2(uv.x*7.0 + 3.0, 0.5))*0.05
          + vnoise(vec2(uv.x*90.0, 1.0))*0.012;
  col = mix(col, vec3(0.004, 0.006, 0.004), smoothstep(g+0.003, g-0.003, uv.y));

  // fireflies low over the grass
  vec2 fp = vec2(uv.x*14.0 + sin(iTime*0.11)*2.0, uv.y*30.0 - iTime*0.06);
  float ff = step(0.993, h21(floor(fp)));
  ff *= pow(0.5 + 0.5*sin(iTime*1.7 + h21(floor(fp))*90.0), 3.0);
  col += vec3(0.65, 0.85, 0.25) * ff * smoothstep(0.22, 0.10, uv.y) * smoothstep(0.03, 0.08, uv.y);

  fragColor = vec4(col, 1.0);
}`
},
{
  id: 'builtin-honkytonk-beams',
  name: 'Honky-Tonk Beams',
  builtin: true,
  code: `// Honky-Tonk Beams — smoky stage light sweeps and drifting dust
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x),
             mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a*vnoise(p); p = p*2.05 + 9.3; a *= 0.5; }
  return v;
}

float beam(vec2 p, vec2 src, float baseAng, float sweep, float phase, float width){
  vec2 d = p - src;
  float ang = atan(d.x, -d.y);   // 0 points straight down
  float target = baseAng + sin(iTime*0.22 + phase)*sweep;
  float a = ang - target;
  float fall = exp(-a*a/(width*width));
  fall *= exp(-length(d)*0.7);
  fall *= 1.0 - smoothstep(-0.05, 0.02, d.y);   // beams only exist below their source
  return fall;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 uv = (fragCoord - 0.5*iResolution.xy) / iResolution.y;
  float smoke = 0.55 + 0.45*fbm(uv*2.5 + vec2(iTime*0.05, iTime*0.02));

  // dark wood-warm room base
  vec3 col = mix(vec3(0.05, 0.025, 0.012), vec3(0.015, 0.008, 0.006), uv.y + 0.5);

  vec3 amber = vec3(1.00, 0.62, 0.20);
  vec3 red   = vec3(0.95, 0.22, 0.12);
  vec3 gold  = vec3(1.00, 0.85, 0.45);

  col += amber * beam(uv, vec2(-0.55, 0.62), 0.25, 0.45, 0.0, 0.10) * smoke * 0.85;
  col += red   * beam(uv, vec2( 0.00, 0.66), 0.00, 0.60, 2.1, 0.085) * smoke * 0.75;
  col += gold  * beam(uv, vec2( 0.55, 0.62), -0.25, 0.45, 4.2, 0.10) * smoke * 0.85;

  // dust motes, brightest where the beams are
  float lightAmt = clamp(length(col) - 0.1, 0.0, 1.0);
  vec2 dp = uv*22.0 + vec2(sin(iTime*0.1), -iTime*0.07);
  vec2 id = floor(dp);
  vec2 f = fract(dp) - 0.5;
  vec2 mp = vec2(h21(id+1.1), h21(id+5.3)) - 0.5 - f;
  float mote = smoothstep(0.06, 0.0, length(mp)) * step(0.55, h21(id));
  mote *= 0.4 + 0.6*sin(iTime*0.9 + h21(id)*40.0);
  col += vec3(1.0, 0.85, 0.6) * mote * (0.08 + lightAmt*0.55);

  // warm floor bounce
  col += vec3(0.30, 0.12, 0.05) * exp(-(uv.y + 0.5)*2.2) * 0.35 * smoke;

  col *= 1.0 - 0.42*dot(uv, uv);
  fragColor = vec4(col, 1.0);
}`
}
];
