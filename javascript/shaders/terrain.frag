uniform float waterHeight;
uniform vec3 waterColor;
uniform vec3 landColor;
uniform float ambientLight;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vHeight;

void main() {
    // Height-based color
    float heightFactor = smoothstep(0.0, waterHeight, vHeight);
    vec3 baseColor = mix(waterColor, landColor, heightFactor);

    // Simple lighting
    vec3 ambient = baseColor * ambientLight * 0.3;

    // Directional light 1
    vec3 lightDir1 = normalize(vec3(1.0, 1.0, 1.0));
    float diff1 = max(dot(vNormal, lightDir1), 0.0);
    vec3 diffuse1 = baseColor * diff1 * 2.0;

    // Directional light 2
    vec3 lightDir2 = normalize(vec3(-1.0, 0.5, -1.0));
    float diff2 = max(dot(vNormal, lightDir2), 0.0);
    vec3 diffuse2 = baseColor * diff2 * 1.0;

    vec3 finalColor = ambient + diffuse1 + diffuse2;

    gl_FragColor = vec4(finalColor, 1.0);
}
