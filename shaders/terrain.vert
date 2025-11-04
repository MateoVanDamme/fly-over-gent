varying vec3 vNormal;
varying vec3 vPosition;
varying float vHeight;

void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    // Use position.z for height since geometry is rotated (Z-up becomes Y-up)
    vHeight = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
